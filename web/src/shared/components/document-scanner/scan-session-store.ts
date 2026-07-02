// Durabilidade contra tab-kill: em Android de baixa RAM o SO mata a aba em
// segundo plano (ligacao, troca de app) com frequencia. Sem persistir, o usuario
// perde todas as paginas ja capturadas. Aqui cada pagina normalizada (Blob) e
// gravada em IndexedDB — DISCO, nao RAM: sobrevive ao reload e ainda ALIVIA a
// memoria (da para soltar o Blob do heap e reler sob demanda).
//
// Politica de liberacao de disco (sem "orfao local"): a sessao e apagada no
// envio bem-sucedido, ao descartar/recusar recuperacao, e por varredura de TTL
// na abertura. Teto = uma sessao ativa. Armazenamento best-effort (o SO pode
// descartar sob pressao) — NAO pedimos persist().

const DB_NAME = 'jf-scan'
const DB_VERSION = 1
const PAGES_STORE = 'pages'
const SESSIONS_STORE = 'sessions'
const SESSION_TTL_MS = 36 * 60 * 60 * 1000 // 36h: cobre tab-kill + retomada

export type StoredScanPage = {
  id: string
  sessionId: string
  sortOrder: number
  blob: Blob
  width: number
  height: number
  createdAt: number
}

type SessionMeta = { sessionId: string; updatedAt: number }

function supportsIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (!supportsIndexedDb()) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PAGES_STORE)) {
        const store = db.createObjectStore(PAGES_STORE, { keyPath: 'id' })
        store.createIndex('bySession', 'sessionId', { unique: false })
      }
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'sessionId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    // Aba anonima / cota 0 / bloqueio: degrada para so-memoria.
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function reqDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Grava/atualiza uma pagina da sessao e marca a sessao como ativa. Best-effort:
// qualquer erro (cota cheia etc.) e engolido — o app segue so em memoria.
export async function saveScanPage(page: StoredScanPage): Promise<void> {
  const db = await openDb()
  if (!db) {
    return
  }
  try {
    const tx = db.transaction([PAGES_STORE, SESSIONS_STORE], 'readwrite')
    tx.objectStore(PAGES_STORE).put(page)
    tx.objectStore(SESSIONS_STORE).put({
      sessionId: page.sessionId,
      updatedAt: page.createdAt,
    } satisfies SessionMeta)
    await txDone(tx)
  } catch {
    // best-effort
  } finally {
    db.close()
  }
}

export async function deleteScanPage(pageId: string): Promise<void> {
  const db = await openDb()
  if (!db) {
    return
  }
  try {
    const tx = db.transaction(PAGES_STORE, 'readwrite')
    tx.objectStore(PAGES_STORE).delete(pageId)
    await txDone(tx)
  } catch {
    // best-effort
  } finally {
    db.close()
  }
}

export async function clearScanSession(sessionId: string): Promise<void> {
  const db = await openDb()
  if (!db) {
    return
  }
  try {
    const tx = db.transaction([PAGES_STORE, SESSIONS_STORE], 'readwrite')
    const index = tx.objectStore(PAGES_STORE).index('bySession')
    const keys = await reqDone(index.getAllKeys(IDBKeyRange.only(sessionId)))
    for (const key of keys) {
      tx.objectStore(PAGES_STORE).delete(key)
    }
    tx.objectStore(SESSIONS_STORE).delete(sessionId)
    await txDone(tx)
  } catch {
    // best-effort
  } finally {
    db.close()
  }
}

// Varredura de TTL + retorno da sessao pendente mais recente (uma sessao ativa).
// Apaga sessoes velhas (tab-kill + abandono) e devolve as paginas da pendente,
// se houver, para oferecer recuperacao.
export async function loadPendingScanSession(): Promise<{
  sessionId: string
  pages: StoredScanPage[]
} | null> {
  const db = await openDb()
  if (!db) {
    return null
  }
  try {
    const now = Date.now()

    // 1) coleta metadados e separa expiradas.
    const readTx = db.transaction(SESSIONS_STORE, 'readonly')
    const sessions = await reqDone(
      readTx.objectStore(SESSIONS_STORE).getAll() as IDBRequest<SessionMeta[]>,
    )
    const expired = sessions.filter((s) => now - s.updatedAt > SESSION_TTL_MS)
    const alive = sessions
      .filter((s) => now - s.updatedAt <= SESSION_TTL_MS)
      .sort((a, b) => b.updatedAt - a.updatedAt)

    // 2) limpa as expiradas (nao deixa orfao local).
    for (const stale of expired) {
      await clearScanSession(stale.sessionId)
    }

    if (alive.length === 0) {
      return null
    }

    // 3) mantem apenas a mais recente como ativa; limpa as demais.
    const [current, ...older] = alive
    for (const other of older) {
      await clearScanSession(other.sessionId)
    }

    const pagesTx = db.transaction(PAGES_STORE, 'readonly')
    const index = pagesTx.objectStore(PAGES_STORE).index('bySession')
    const pages = await reqDone(
      index.getAll(IDBKeyRange.only(current.sessionId)) as IDBRequest<
        StoredScanPage[]
      >,
    )
    if (pages.length === 0) {
      await clearScanSession(current.sessionId)
      return null
    }
    pages.sort((a, b) => a.sortOrder - b.sortOrder)
    return { sessionId: current.sessionId, pages }
  } catch {
    return null
  } finally {
    db.close()
  }
}
