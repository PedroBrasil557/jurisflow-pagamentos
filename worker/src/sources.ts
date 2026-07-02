// Adaptadores das DUAS filas de quitacao atras de uma interface comum, para o pool
// unificado consumir ambas sem acoplar-se ao formato de cada uma:
//   - PROCESSOS  -> /api/internal/caixa-quitacao  (job = processo com 1-2 CPFs;
//                   short-circuit no 1o quitado; fencing por claimToken)
//   - TITULARES  -> /api/internal/quitacao        (fila generica; 1 CPF/job;
//                   fencing por leaseToken)

export type PerCpfResult = {
  cpf: string
  result: 'quitado' | 'nao_encontrado' | 'erro'
  message?: string
}

export type ConsultaPdf = { filename: string; bytes: Buffer } | null

// Um job normalizado: a lista de CPFs a consultar (na ordem, com short-circuit no
// 1o quitado) e como reportar o desfecho de volta para a fila de origem.
export type ClaimedJob = {
  source: string
  label: string
  cpfs: string[]
  report(consultas: PerCpfResult[], pdf: ConsultaPdf): Promise<void>
}

export type Source = {
  name: string
  claim(): Promise<ClaimedJob | null>
}

// Erro do claim classificado: 'config' (404/401/403 — URL/rota/versao da API ou
// token errados; NAO transitorio) vs 'transient' (5xx/rede — tentar de novo).
export class ClaimError extends Error {
  constructor(
    readonly kind: 'config' | 'transient',
    message: string,
  ) {
    super(message)
    this.name = 'ClaimError'
  }
}

type SourceConfig = { apiUrl: string; token: string }

// Faz o POST /claim e classifica a falha. 4xx (404/401/403) = configuracao (rota/
// token errados), NAO "fila vazia"; 5xx/rede = transitorio. Retorna o JSON cru.
async function postClaim(
  cfg: SourceConfig,
  path: string,
): Promise<{ job: unknown }> {
  let res: Response
  try {
    res = await fetch(`${cfg.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'x-internal-token': cfg.token },
    })
  } catch (error) {
    throw new ClaimError(
      'transient',
      `rede: ${error instanceof Error ? error.message : 'falha'}`,
    )
  }
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    throw new ClaimError(
      'config',
      `HTTP ${res.status} em ${cfg.apiUrl}${path} — confira API_URL, se a rota existe nessa versao da API, e o INTERNAL_API_TOKEN.`,
    )
  }
  if (!res.ok) {
    throw new ClaimError('transient', `HTTP ${res.status}`)
  }
  return (await res.json()) as { job: unknown }
}

async function postResult(
  cfg: SourceConfig,
  path: string,
  body: unknown,
): Promise<void> {
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'x-internal-token': cfg.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`result HTTP ${res.status}`)
  }
}

const pdfBase64 = (pdf: ConsultaPdf): string | null =>
  pdf ? pdf.bytes.toString('base64') : null

// PROCESSOS: job com 1-2 CPFs (titular + conjuge/co-comprador). O /result envia o
// array por CPF + o claimToken (fencing) + o PDF do CPF que quitou.
export function createProcessosSource(cfg: SourceConfig): Source {
  type ProcessJob = { processId: string; cpfs: string[]; claimToken: string }
  return {
    name: 'processos',
    async claim(): Promise<ClaimedJob | null> {
      const { job } = (await postClaim(
        cfg,
        '/api/internal/caixa-quitacao/claim',
      )) as { job: ProcessJob | null }
      if (!job) {
        return null
      }
      return {
        source: 'processos',
        label: `processo=${job.processId}`,
        cpfs: job.cpfs,
        report: (consultas, pdf) =>
          postResult(cfg, '/api/internal/caixa-quitacao/result', {
            processId: job.processId,
            claimToken: job.claimToken,
            consultas,
            pdfBase64: pdfBase64(pdf),
            pdfFilename: pdf?.filename ?? null,
          }),
      }
    },
  }
}

// TITULARES (fila generica): 1 CPF por job. O /result envia um unico desfecho +
// leaseToken (fencing). Como ha 1 CPF, usa consultas[0].
export function createTitularesSource(cfg: SourceConfig): Source {
  type TitularJob = {
    jobId: string
    leaseToken: string
    subjectType: string
    subjectId: string
    cpf: string
  }
  return {
    name: 'titulares',
    async claim(): Promise<ClaimedJob | null> {
      const { job } = (await postClaim(
        cfg,
        '/api/internal/quitacao/claim',
      )) as {
        job: TitularJob | null
      }
      if (!job) {
        return null
      }
      return {
        source: 'titulares',
        label: `titular=${job.subjectId}`,
        cpfs: [job.cpf],
        report: (consultas, pdf) => {
          const outcome = consultas[0]
          return postResult(cfg, '/api/internal/quitacao/result', {
            jobId: job.jobId,
            leaseToken: job.leaseToken,
            result: outcome?.result ?? 'erro',
            message: outcome?.message,
            pdfBase64: pdfBase64(pdf),
            pdfFilename: pdf?.filename ?? null,
          })
        },
      }
    },
  }
}
