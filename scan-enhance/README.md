# scan-enhance

Microserviço de realce server-side do scan (parte da alternativa "Scan HD").
Recebe o PDF bruto da digitalização, realça cada página (achatamento de
iluminação/sombra + CLAHE + unsharp, **preservando cor** — nunca binariza,
RG/CNH são coloridos e têm foto) e devolve o PDF reconstruído a 300 DPI com as
métricas de nitidez por página.

O worker de ingestão da API chama este serviço **antes** da classificação por
IA quando `SCAN_ENHANCE_URL` está definido; qualquer falha aqui é
não-bloqueante (a ingestão segue com o PDF original, que permanece no S3).

## Endpoints

- `GET /health` → `{"status":"ok"}`
- `POST /enhance` — corpo `application/pdf` (≤25 MB, ≤50 páginas) → corpo
  `application/pdf` realçado + header `x-enhance-metrics` com JSON
  `[{page, sharpnessBefore, sharpnessAfter, width, height}]`.

## Rodando

```bash
# via compose (raiz do repo)
docker compose up -d scan-enhance

# local (venv)
pip install -r requirements.txt
uvicorn app.main:app --port 8000

# testes
pip install pytest && pytest
```

## Roadmap (etapas de IA planejadas)

O pipeline atual é clássico (OpenCV). Quando não bastar, as próximas etapas —
todas com licença comercial segura — entram como estágios adicionais em
`app/enhance.py`:

1. **DocAligner** (Apache-2.0, ONNX ~5 MB) — refinar cantos/perspectiva quando
   o crop client-side falhar (confiança baixa).
2. **UVDoc via PaddleOCR** (Apache-2.0, ONNX ~30 MB, ~870 ms CPU) — dewarp de
   comprovante amassado/curvo (pular para RG/CNH, que são rígidos).
3. **DocRes** (MIT) — deshadow/restauração neural, se o achatamento clássico
   não bastar. Requer mais CPU (ou GPU) — medir antes.

Regra fixa: **sem super-resolução/deblur agressivo** em números de documento
(risco de alucinar glifos); deblur neural conservador (NAFNet) só com validação.
