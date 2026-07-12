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
from .fit import encode_to_target
from .pdf_io import PageLimitError, pages_to_pdf, rasterize_pdf

# Mesmos tetos do app (cliente limita o PDF a 25 MB / 15 paginas; 50 aqui e
# folga para lotes de import futuros).
MAX_BODY_BYTES = 25 * 1024 * 1024
MAX_PAGES = 50

app = FastAPI(title="scan-enhance", docs_url=None, redoc_url=None)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


def _enhance_pdf(pdf_bytes: bytes) -> tuple[bytes, object]:
    pages = rasterize_pdf(pdf_bytes, MAX_PAGES)
    enhanced: list = []
    metrics: list[dict] = []
    for index, page in enumerate(pages):
        out, page_metrics = enhance_page(page)
        enhanced.append(out)
        metrics.append({"page": index + 1, **page_metrics})
    return pages_to_pdf(enhanced), metrics


def _enhance_fit_pdf(pdf_bytes: bytes, max_bytes: int) -> tuple[bytes, object]:
    # Realca UMA vez e entao encoda-para-caber por pagina (encode_to_target).
    # O lote ja vem desmembrado por documento (o chamador manda 1 parte por vez).
    pages = rasterize_pdf(pdf_bytes, MAX_PAGES)
    enhanced = [enhance_page(page)[0] for page in pages]
    return encode_to_target(enhanced, max_bytes)


def _fit_pdf(pdf_bytes: bytes, max_bytes: int) -> tuple[bytes, object]:
    # SO reduz-para-caber por pagina, SEM realce. Para backfill de arquivos JA
    # anexados: um scan legado ja foi realcado (re-realcar super-processaria) e um
    # PDF nato-digital nao deve ser realcado. Rasteriza e encoda-para-caber.
    pages = rasterize_pdf(pdf_bytes, MAX_PAGES)
    return encode_to_target(pages, max_bytes)


def _parse_max_bytes(raw: str | None) -> int | None:
    if raw is None:
        return None
    if not raw.isdigit() or int(raw) <= 0:
        raise HTTPException(
            status_code=400, detail="max_bytes deve ser um inteiro positivo."
        )
    return int(raw)


async def _read_pdf_body(request: Request) -> bytes:
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
    return body


def _metrics_response(pdf_out: bytes, metrics: object) -> Response:
    return Response(
        content=pdf_out,
        media_type="application/pdf",
        headers={"x-enhance-metrics": json.dumps(metrics, separators=(",", ":"))},
    )


@app.post("/enhance")
async def enhance(request: Request) -> Response:
    body = await _read_pdf_body(request)

    # max_bytes presente => realce + encode-para-caber (<= max_bytes) por pagina;
    # ausente => realce uniforme (comportamento original).
    max_bytes = _parse_max_bytes(request.query_params.get("max_bytes"))

    try:
        # Threadpool: rasterizacao + OpenCV sao CPU-bound; nao bloqueia o loop.
        if max_bytes is not None:
            pdf_out, metrics = await to_thread.run_sync(
                _enhance_fit_pdf, body, max_bytes
            )
        else:
            pdf_out, metrics = await to_thread.run_sync(_enhance_pdf, body)
    except PageLimitError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return _metrics_response(pdf_out, metrics)


@app.post("/fit")
async def fit(request: Request) -> Response:
    # Reduz-para-caber SEM realce (backfill de arquivos ja anexados em prod).
    # max_bytes e OBRIGATORIO aqui (nao ha modo "so realce" no /fit).
    body = await _read_pdf_body(request)
    max_bytes = _parse_max_bytes(request.query_params.get("max_bytes"))
    if max_bytes is None:
        raise HTTPException(status_code=400, detail="max_bytes e obrigatorio em /fit.")

    try:
        pdf_out, metrics = await to_thread.run_sync(_fit_pdf, body, max_bytes)
    except PageLimitError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return _metrics_response(pdf_out, metrics)
