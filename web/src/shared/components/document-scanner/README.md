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

- **`scanbot`**: usa o **Scanbot Web SDK** (RTU UI ui2) — qualidade CamScanner
  (captura automática, ajuste de cantos, perspectiva, remoção de sombra) no
  navegador, inclusive no iPhone. Ver [scanbot-scan.ts](./scanbot-scan.ts).
  Requer license. **Falha dura** (sem license / SDK não inicia) cai no scanner
  web **com aviso** (toast com o motivo) — digitalizar nunca fica 100% quebrado.
- **`web`** (padrão): usa **jscanify + OpenCV.js** com ajuste manual dos 4
  cantos e filtros. Ver [web-scanner-dialog.tsx](./web-scanner-dialog.tsx).

Ambos produzem um `File` PDF e entregam por `onComplete(file)`. O backend não
muda (aceita PDF/qualquer mime até 25 MB).

### Arquivos
- `scan-button.tsx` — botão público; lê o provider e seleciona o motor (lazy import).
- `scanbot-license.ts` — queries da license e do provider (Configurações via API).
- `scanbot-scan.ts` — scanner via Scanbot Web SDK (import `scanbot-web-sdk/ui`, init + RTU UI + PDF).
- `web-scanner-dialog.tsx` — scanner web (jscanify): câmera, cantos, filtros, revisão.
- `scanner-engine.ts` — carrega OpenCV.js + jscanify sob demanda; detecção de cantos.
- `scan-enhance.ts` — realce ("cara de escaneado"): iluminação, Sauvola, unsharp.
- `scan-to-pdf.ts` — monta o PDF multipágina (jspdf). Coberto por testes.

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

### Vendoring do OpenCV.js
`OpenCV.js` (~8 MB) e `jscanify.js` ficam em `web/public/vendor/` e são
carregados **sob demanda** (somente ao abrir o scanner web), nunca no bundle
inicial.

## Pontos de atenção
- **HTTPS** é obrigatório para usar a câmera em mobile (`localhost` ok no dev).
- O scanner web (jscanify) tem qualidade inferior ao Scanbot; o ajuste manual de
  cantos cobre os casos em que a detecção automática falha.
