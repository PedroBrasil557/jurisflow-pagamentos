# scan-enhance: microservico de realce server-side do scan (JurisFlow).
# Recebe o PDF bruto da digitalizacao e devolve o PDF com paginas realcadas
# (achatamento de iluminacao/sombra + CLAHE + unsharp, preservando cor) e as
# metricas de nitidez por pagina no header `x-enhance-metrics`.
#
# Contrato de resiliencia: o chamador (worker de ingestao) trata QUALQUER falha
# aqui como nao-bloqueante e segue com o PDF original.

import json

from anyio import to_thread
from fastapi import FastAPI, HTTPException, Request, Response

from .enhance import enhance_page
from .pdf_io import PageLimitError, pages_to_pdf, rasterize_pdf

# Mesmos tetos do app (cliente limita o PDF a 25 MB / 15 paginas; 50 aqui e
# folga para lotes de import futuros).
MAX_BODY_BYTES = 25 * 1024 * 1024
MAX_PAGES = 50

app = FastAPI(title="scan-enhance", docs_url=None, redoc_url=None)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


def _enhance_pdf(pdf_bytes: bytes) -> tuple[bytes, list[dict]]:
    pages = rasterize_pdf(pdf_bytes, MAX_PAGES)
    enhanced: list = []
    metrics: list[dict] = []
    for index, page in enumerate(pages):
        out, page_metrics = enhance_page(page)
        enhanced.append(out)
        metrics.append({"page": index + 1, **page_metrics})
    return pages_to_pdf(enhanced), metrics


@app.post("/enhance")
async def enhance(request: Request) -> Response:
    # Rejeicao BARATA antes de materializar o corpo: um POST gigante nao deve
    # inflar a RAM so para receber 413. (Nao cobre chunked/sem Content-Length —
    # o check pos-leitura abaixo continua valendo.)
    length_header = request.headers.get("content-length")
    if length_header and length_header.isdigit() and int(length_header) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="PDF acima de 25 MB.")

    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Corpo vazio.")
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="PDF acima de 25 MB.")
    if not body.startswith(b"%PDF"):
        raise HTTPException(status_code=415, detail="Corpo nao e um PDF.")

    try:
        # Threadpool: rasterizacao + OpenCV sao CPU-bound; nao bloqueia o loop.
        pdf_out, metrics = await to_thread.run_sync(_enhance_pdf, body)
    except PageLimitError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return Response(
        content=pdf_out,
        media_type="application/pdf",
        headers={"x-enhance-metrics": json.dumps(metrics, separators=(",", ":"))},
    )
