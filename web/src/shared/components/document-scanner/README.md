# Scanner de documentos (qualidade CamScanner)

Captura de documentos por câmera com detecção de borda, ajuste de cantos,
correção de perspectiva e realce ("cara de escaneado"), gerando um **PDF
multipágina** que entra no fluxo de upload existente (checklist e lote).

> Apenas web. Não há app nativo/Capacitor — o Scanbot Web SDK roda no próprio
> navegador, inclusive no iPhone.

## Arquitetura

O serviço é escolhido em **Configurações → Scanner** (admin) e exposto ao
cliente pela API. O `<ScanButton>` lê essa escolha (`scannerProviderQuery`) em
tempo de execução:

- **`docaligner`** (padrão): scanner do navegador com **detecção de bordas por
  IA** (modelo DocAligner em ONNX via `onnxruntime-web`, backend WASM SIMD) e
  **recorte/deskew por WebGL** (homografia, ver [scan-warp.ts](./scan-warp.ts)).
  Open-source, **sem license**. Ver [web-scanner-dialog.tsx](./web-scanner-dialog.tsx)
  e [docaligner/](./docaligner/). Se a IA não achar os cantos (ou o modelo não
  carregar), o usuário **ajusta os 4 cantos manualmente**.
- **`scanbot`**: usa o **Scanbot Web SDK** (RTU UI ui2) — qualidade CamScanner
  (captura automática, ajuste de cantos, perspectiva, remoção de sombra) no
  navegador, inclusive no iPhone. Ver [scanbot-scan.ts](./scanbot-scan.ts).
  Requer license. **Falha dura** (sem license / SDK não inicia) cai no scanner
  do navegador **com aviso** (toast com o motivo) — digitalizar nunca fica 100% quebrado.

> O antigo provider `web` (OpenCV.js + jscanify) foi **removido**: a detecção é só
> a IA e o warp é WebGL — sem os ~8.6 MB do `opencv.js`. Valores salvos `web` migram
> para `docaligner` na leitura.

Todos produzem um `File` PDF e entregam por `onComplete(file)`. O backend não
muda (aceita PDF/qualquer mime até 25 MB).

### Arquivos
- `scan-button.tsx` — botão público; lê o provider e seleciona o motor (lazy import).
- `scanbot-license.ts` — queries da license e do provider (Configurações via API).
- `scanbot-scan.ts` — scanner via Scanbot Web SDK (import `scanbot-web-sdk/ui`, init + RTU UI + PDF).
- `web-scanner-dialog.tsx` — scanner do navegador: câmera, cantos, filtros, revisão.
- `scanner-engine.ts` — geometria pura dos cantos (`orderCorners`, `isPlausibleQuad`,
  tipos, abstração `CornerDetector`). **Sem OpenCV.**
- `scan-warp.ts` — recorte + deskew por **WebGL** (homografia 4-pontos). Substitui o
  `cv.warpPerspective` do OpenCV; fallback devolve a imagem não recortada.
- `docaligner/` — motor de detecção por IA (ONNX): `config`, `preprocess`,
  `postprocess`, `runtime` (onnxruntime-web), `worker` (inferência off-main-thread),
  `detector`, `index` (hook). A inferência roda num **Web Worker** para o preview ao
  vivo não travar o vídeo (cada inferência custa ~200–400 ms no WASM).
- `scan-enhance.ts` — realce ("cara de escaneado"): iluminação, Sauvola, unsharp.
- `scan-to-pdf.ts` — monta o PDF multipágina (jspdf). Coberto por testes.

## DocAligner (detecção por IA)

1. O provider **Navegador (IA)** é o padrão em Configurações → Scanner.
2. Coloque o modelo em `public/vendor/docaligner/model.onnx` (ver
   [public/vendor/docaligner/README.md](../../../../public/vendor/docaligner/README.md)).
   Sem o modelo, não há detecção automática — o usuário ajusta os cantos manualmente
   (o recorte por WebGL segue funcionando).
3. O `.wasm` e o `.mjs` do `onnxruntime-web` são resolvidos pelo Vite via `?url`
   (a partir do `node_modules`, em `runtime.ts`) — **não** ficam em `public/`,
   pois o Vite proíbe importar módulos de `public/` no dev (o ORT faz `import()`
   do `.mjs`). Build usado: `onnxruntime-web/wasm` (só WASM, sem o jsep do WebGPU).
4. **Multithread do ORT** exige cross-origin isolation (COOP/COEP); por padrão
   roda SIMD single-thread, sem exigir headers.
5. Modelo embarcado: **heatmap `lcnet100`** (256 BGR/255 → `[1,4,128,128]`). Trocar
   de variante heatmap é só substituir o `model.onnx` (o código lê as dimensões do
   heatmap em runtime). **Confirmar a licença do DocAligner** antes de uso comercial.

## License do Scanbot

A license efetiva no cliente segue esta ordem:

1. A salva em **Configurações → Scanner** (banco, via API) — tem prioridade.
2. Fallback de build: `VITE_SCANBOT_LICENSE_KEY` em `web/.env.local` (não versionado).

A chave é **travada por domínio** — gere uma para o domínio onde o app roda
(para dev local com HTTPS/ngrok, use um domínio estático no painel do Scanbot).
Sem license, o `<ScanButton>` usa o scanner web.

### Assets WASM
Os binários do Scanbot (~24 MB) são copiados para
`web/public/vendor/document-scanner/` por
[scripts/copy-scanbot-assets.mjs](../../../../scripts/copy-scanbot-assets.mjs),
que roda automaticamente antes de `dev` e `build` (ver `package.json`). Ficam
fora do git via `.gitignore`. No Docker, após instalar deps rode
`docker compose exec web bun install` e reinicie o serviço web.

## Pontos de atenção
- **HTTPS** é obrigatório para usar a câmera em mobile (`localhost` ok no dev).
- A detecção automática é só a IA (DocAligner); o **ajuste manual dos 4 cantos**
  cobre os casos em que ela falha ou o modelo não carrega.
- O **warp** (recorte/deskew) é WebGL; sem WebGL, a imagem é usada sem recorte.
