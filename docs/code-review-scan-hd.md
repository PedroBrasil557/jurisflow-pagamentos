# Code review — feat/scan-hd (2026-07-04)

Revisão multi-agente (esforço xhigh: 10 ângulos de busca → verificação 3 estados → varredura final) sobre o changeset não commitado da branch `feat/scan-hd` (provider Scan HD + microserviço scan-enhance). 15 achados, ranqueados por severidade.

Vereditos: **CONFIRMADO** = inputs/estado que disparam e saída errada identificados (o nº 1 foi confirmado empiricamente, executando o pipeline). **PLAUSÍVEL** = mecanismo real, gatilho incerto.

> **Status: todos os 15 achados corrigidos (2026-07-04).** Verificado: typecheck web+api OK, 34 testes vitest OK, 9 pytest (inclui casos coloridos + cap de MediaBox) OK; e2e no Docker com PDF colorido confirmou vermelho/verde/azul preservados (fix de cor) e sombra achatada; migration 0032 (coluna `source`) aplicada no banco. Cada item abaixo traz a resolução aplicada.

## Bugs de correção

### 1. Inversão de canais R/B em toda página colorida realçada — CONFIRMADO (empiricamente)
`scan-enhance/app/pdf_io.py:33` — o `bitmap.to_numpy()` do pypdfium2 já devolve **BGR** (render default), mas o código assume RGB e aplica `cv2.cvtColor(..., COLOR_RGB2BGR)`, invertendo R↔B.

Prova: PDF com página vermelha pura → `to_numpy()` central = `[0, 0, 254]` (BGR correto) → saída do `rasterize_pdf` = `[254, 0, 0]` = **azul**. Foto 3x4 de RG/CNH sai azulada, carimbos vermelhos viram azuis — exatamente os documentos que o pipeline promete preservar. Invisível nos testes (fixtures cinza, R=G=B).

**Fix:** usar o buffer direto (já é BGR); tratar `COLOR_BGRA2BGR` quando vier com alfa. Adicionar teste com fixture colorida.

### 2. PDF realçado sem guarda de tamanho pode estourar o teto de 32 MB da extração → dead-letter determinístico — CONFIRMADO
`api/src/modules/processes/processes.batch.service.ts:612` — o realce infla o arquivo (~6x medido; o render a 300 DPI chega a fazer upscale de páginas já limitadas a 2600–3500px no cliente) e substitui `workingBytes` sem checar tamanho.

Cenário: scan de 15 páginas coloridas de ~6–10 MB → realçado com 25–35+ MB → `toExtractionInputFile` lança 413 (`MAX_FILE_SIZE_IN_BYTES = 32 MB`, `processes.extraction.service.ts:31`) → falha FATAL; a fila re-executa re-rodando o enhance a cada retry até dead-letter — sendo que o original teria extraído normalmente.

**Fix:** usar o realçado só se couber no limite (ou se não crescer além de N%), senão manter o original; logar bytes antes/depois; no serviço, limitar o scale do render à resolução nativa da página (não upscalar).

### 3. Sem teto de dimensões em pixels no render → OOM com MediaBox gigante — CONFIRMADO
`scan-enhance/app/pdf_io.py:26` — só nº de páginas (50) e bytes do corpo (25 MB) são limitados. Um PDF de poucos KB com página de 200×200 polegadas rasteriza a ~60.000px de lado a 300 DPI ≈ **10,8 GB por página** → OOM; `compose.yml` não define `mem_limit` e o `restart: unless-stopped` vira crash-loop. Em dev, a porta 3560 é publicada no host sem auth.

**Fix:** cap de pixels por página (ex.: lado longo ≤ 4200px, reduzindo o scale proporcionalmente) + `mem_limit` no compose.

### 4. Import com fileName 'scan.pdf' casa o gate do enhance e degrada PDF nato-digital — CONFIRMADO
`api/src/modules/processes/processes.batch.service.ts:607` — o gate discrimina scan vs import pelo nome de exibição (`originalFileName === 'scan.pdf'`), mas o caminho de import grava o `fileName` livre do usuário verbatim (`:1253`; schemas validam só `z.string().min(1).max(255)`). Um PDF texto-vetorial importado com esse nome é rasterizado (perda de texto pesquisável/qualidade).

**Fix estrutural:** coluna `source: 'scan' | 'import'` no `processBatchFile`, gravada nos dois insert sites, em vez de string mágica de apresentação.

### 5. iOS + HD + câmera falhada: foto nativa volta para a tela de câmera quebrada — CONFIRMADO
`web/src/shared/components/document-scanner/web-scanner-dialog.tsx:784` — com `cameraFailed=true` (nunca reseta fora do close), o botão "Tirar foto" grava `nativeReturnScreenRef='camera'`; após a foto, `setScreen('camera')` reexibe "Nao foi possivel acessar a camera" em vez de ir para a revisão — contradizendo o próprio comentário do código. Mitigação: o botão-miniatura de revisão continua acessível.

**Fix:** quando `cameraFailed`, retornar sempre a `'review'`.

### 6. Falso positivo de glare em papel superexposto — PLAUSÍVEL
`web/src/shared/components/document-scanner/sharpness.ts:25` — limiar (≥252 em >5% dos pixels) dispara com papel branco clipado por exposição alta, não só reflexo especular → aviso "Ha reflexo de luz" + badge em página legível; ruído ensina o usuário a ignorar o gate.

**Confirmação/mitigação:** testar com fotos reais superexpostas; exigir cluster espacial contíguo ou condicionar à média global.

### 7. Telemetria pageLongEdgesPx satura no teto de normalização e não registra a fonte da captura — PLAUSÍVEL
`web/src/shared/components/document-scanner/web-scanner-dialog.tsx:930` — mede o recorte já normalizado (teto 2600/3500px): still de 50 MP e frame 4K logam ambos ~3500, indistinguíveis. A métrica que deveria justificar o Scan HD (e a decisão sobre wrapper nativo) fica cega acima do teto.

**Fix barato:** logar também `captureSource` (`'still' | 'frame' | 'native'`) e o lado longo BRUTO pré-normalização por página.

### 8. request.body() materializa o corpo antes do check de 25 MB — CONFIRMADO (baixa)
`scan-enhance/app/main.py:43` — a rejeição por tamanho é pós-hoc; corpos gigantes concorrentes inflam a RAM antes do 413. **Fix:** rejeitar cedo por `Content-Length` e/ou ler o stream com teto incremental.

### 9. Auditoria conta páginas do PDF original, extração usa o realçado — PLAUSÍVEL (baixa)
`api/src/modules/processes/processes.batch.service.ts:659` — `countPdfPages(bytes)` vs `workingBytes`; só não diverge porque o serviço preserva 1:1 hoje. **Fix trivial:** `countPdfPages(workingBytes)`.

### 10. SCAN_ENHANCE_URL sem esquema passa no z.url() → feature silenciosamente morta — PLAUSÍVEL (baixa)
`api/src/shared/config/env.ts:79` — `'scan-enhance:8000'` parseia com protocol `scan-enhance:` e o boot aceita; todo fetch falha e o best-effort engole. **Fix:** validar protocolo http/https no schema.

### 11. Limite de 15 páginas não desabilita a captura no modo HD — PLAUSÍVEL (baixa)
`web/src/shared/components/document-scanner/web-scanner-dialog.tsx:747` — no limite, o shutter paga o `takePhoto` (~1s) + decode ANTES da guarda; a foto nativa é descartada e `handleFilesSelected` ainda navega. **Fix:** desabilitar shutter/botões com `pages.length >= MAX_SCAN_PAGES` e checar o limite antes de capturar.

## Limpezas (reuso / simplificação / eficiência)

### 12. Métricas de qualidade computadas mas nunca consumidas — CONFIRMADO
`web/src/shared/components/document-scanner/sharpness.ts:92` — `tenengradScore` (passada Sobel inteira) e os campos de `PageQuality` além de `warnings` não vão a lugar nenhum; o comentário "vai na telemetria" promete pipeline que não existe. **Ou** ligar ao `scan/complete` **ou** remover até haver consumidor.

### 13. Rec.601 duplicado em 5 pontos — CONFIRMADO
`web/src/shared/components/document-scanner/sharpness.ts:141` — `toLuminance` reimplementa a conversão que `scan-enhance.ts` (web) já inlineia 4x. Extrair helper único compartilhado.

### 14. 6 conversões BGR↔LAB por página no enhance — CONFIRMADO
`scan-enhance/app/enhance.py:85` — cada etapa (flatten/CLAHE/unsharp) converte ida e volta operando no mesmo canal L. Converter 1x, encadear as operações L→L, voltar 1x (~dezenas de ms e ~26–43 MB de alocação poupados por conversão).

### 15. Union ScannerProvider redeclarado em 5 lugares — CONFIRMADO
`web/src/features/settings/services/settings.service.ts:19` — api service, api z.enum, web scanbot-license, web settings.service e local em settings-page; este diff precisou editar todos. Derivar de fonte única (`z.infer` do schema na api; `InferRequestType` da rota RPC no web).

---

Recomendação: aplicar no mínimo os confirmados 1–5 antes de commitar; 12–15 são baratos e cabem no mesmo passe.
