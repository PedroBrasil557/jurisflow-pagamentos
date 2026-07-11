# Harness offline de avaliacao do scanner (bench-fixtures)

Mede, **sem risco em producao**, qual preset de tuning (`scanner-tuning.ts`)
recorta melhor os documentos — em especial se a faixa externa (assinaturas,
rubricas) fica dentro do recorte. Roda os presets sobre um conjunto de fixtures
rotuladas e imprime, por preset: IoU medio vs. verdade, **% de conteudo
cortado**, % de fallback e % marcado para revisao.

Detecção de borda **não tem ground truth automatico** — por isso as fixtures sao
rotuladas a mao (uma vez) e as deteccoes CRUAS do DocAligner sao capturadas uma
vez rodando o detector real. O eixo margem/fallback/revisao e varrido sobre esse
mesmo `detections.json` (o quad cru nao muda); trocar de **modelo** ou ligar
**letterbox** muda a deteccao — ai capture um `detections.json` por variante.

## Rodar

```bash
cd web
# Com os arquivos reais (labels.json + detections.json neste diretorio):
bun scripts/scanner-bench.ts
# Ou apontando para arquivos especificos (ex.: os exemplos):
bun scripts/scanner-bench.ts \
  src/shared/components/document-scanner/bench-fixtures/labels.example.json \
  src/shared/components/document-scanner/bench-fixtures/detections.example.json
```

## Formato

### `labels.json` — `BenchFixture[]` (rotulado a mao, uma vez)

```json
[{
  "id": "termo-caixa-p1",
  "width": 2480, "height": 3508,
  "trueCorners": {
    "topLeftCorner": {"x": 40, "y": 40}, "topRightCorner": {"x": 2440, "y": 40},
    "bottomRightCorner": {"x": 2440, "y": 3468}, "bottomLeftCorner": {"x": 40, "y": 3468}
  },
  "contentBBox": {"x": 120, "y": 3360, "width": 380, "height": 32}
}]
```

- `width`/`height`: dimensoes da imagem **normalizada** que o scanner detecta
  (lado longo <= 3500; ver `image-normalize.ts`). Rotule na mesma imagem.
- `trueCorners`: os 4 cantos verdadeiros do documento, em pixels.
- `contentBBox`: caixa do conteudo critico que **nao pode ser cortado** (a
  assinatura/rubrica). O bench marca "cortado" quando ela nao cabe inteira no
  recorte final.

### `detections.json` — `BenchDetection[]` (capturado do detector real, uma vez)

```json
[
  { "id": "termo-caixa-p1", "rawQuad": { "topLeftCorner": {"x":80,"y":80}, "...": "..." } },
  { "id": "procuracao-p1", "rawQuad": null }
]
```

- `rawQuad`: a saida CRUA do DocAligner (`postprocess`), **antes** da folga
  (`expandQuad`) e do fallback. `null` = a deteccao falhou (cai no fallback).

## Como capturar `detections.json`

O quad cru sai do detector real. O caminho mais simples, sem infra extra:

1. Em `web-scanner-dialog.tsx`, logo apos `const detected = await detectBest(work)`
   em `addPageFromCanvas`, adicione **temporariamente**:
   ```ts
   console.log('BENCH', JSON.stringify({ id: '<nome-da-fixture>', rawQuad: detected }))
   ```
   (ou logue tambem `work.width/height` para preencher o `labels.json`).
2. Rode o app (`bun run dev`), escaneie cada documento-fixture e colete as linhas
   `BENCH` do console num array `detections.json`.
3. Remova o `console.log` temporario.

Para o eixo **modelo/letterbox**: troque `public/vendor/docaligner/model.onnx`
(ou ligue o letterbox no preprocess), recapture um `detections.<variante>.json`
e rode o bench apontando para ele — assim compara variantes cabeca-a-cabeca.

## Arquivos de exemplo

`labels.example.json` + `detections.example.json` sao um conjunto minimo
(2 fixtures) so para ver a saida: uma com deteccao levemente para dentro (a
folga recupera a assinatura) e uma com deteccao nula (o fallback full-frame
recupera). Substitua por dados reais dos seus documentos.
