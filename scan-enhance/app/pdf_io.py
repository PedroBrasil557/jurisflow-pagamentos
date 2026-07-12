# Rasterizacao (pypdfium2) e remontagem (img2pdf) do PDF de scan. Cada pagina
# vira um bitmap a 300 DPI, passa pelo realce e volta como JPEG embutido sem
# reencode extra (img2pdf embute o JPEG e fixa o DPI, entao o tamanho fisico da
# pagina e preservado).
#
# Duas formas de remontar:
#   - pages_to_pdf: DPI/quality UNIFORMES (caminho /enhance sem max_bytes).
#   - encode_page_jpeg + assemble_pdf: por pagina (caminho encode-para-caber),
#     onde cada pagina pode sair num DPI/quality diferente. O DPI vai embutido
#     no JFIF de cada JPEG (Pillow) e o img2pdf o le, preservando o tamanho
#     fisico A4 mesmo com paginas em resolucoes diferentes no mesmo PDF.

import io

import cv2
import img2pdf
import numpy as np
import pypdfium2 as pdfium
from PIL import Image

RENDER_DPI = 300
JPEG_QUALITY = 87

# Teto do lado longo renderizado (A4 @300 DPI = 3508px + folga). Sem isto, um
# PDF pequeno com MediaBox gigante (ex.: 200x200 pol.) renderizaria a ~60000px
# (~10 GB por pagina) e derrubaria o container por OOM. Acima do teto, o scale
# e reduzido proporcionalmente (a pagina sai menor, nunca estourada).
MAX_RENDER_LONG_EDGE = 4200


class PageLimitError(Exception):
    pass


def rasterize_pdf(
    pdf_bytes: bytes, max_pages: int, render_dpi: int = RENDER_DPI
) -> list[np.ndarray]:
    doc = pdfium.PdfDocument(pdf_bytes)
    try:
        if len(doc) > max_pages:
            raise PageLimitError(f"PDF com mais de {max_pages} paginas.")
        pages: list[np.ndarray] = []
        for page in doc:
            width_pt, height_pt = page.get_size()
            scale = render_dpi / 72.0
            long_edge_px = max(width_pt, height_pt) * scale
            if long_edge_px > MAX_RENDER_LONG_EDGE:
                scale *= MAX_RENDER_LONG_EDGE / long_edge_px
            bitmap = page.render(scale=scale)
            try:
                # Ordem NATIVA do pdfium: BGR(A) — nao RGB (verificado
                # empiricamente: pixel vermelho puro sai [0, 0, 254]).
                raw = bitmap.to_numpy()
            finally:
                bitmap.close()
            # BGR(A) -> BGR proprio; .copy() desacopla do buffer do bitmap.
            pages.append(raw[:, :, :3].copy())
            page.close()
        return pages
    finally:
        doc.close()


def downscale_bgr(bgr: np.ndarray, ratio: float) -> np.ndarray:
    """Reduz o bitmap pela razao dada (INTER_AREA e o melhor p/ downscale).
    ratio >= 1.0 => retorna o bitmap intacto (nunca faz upscale)."""
    if ratio >= 1.0:
        return bgr
    h, w = bgr.shape[:2]
    new_w = max(1, round(w * ratio))
    new_h = max(1, round(h * ratio))
    return cv2.resize(bgr, (new_w, new_h), interpolation=cv2.INTER_AREA)


def encode_page_jpeg(bgr: np.ndarray, quality: int, dpi: int) -> bytes:
    """Encoda 1 pagina em JPEG com o DPI embutido no JFIF (via Pillow), para o
    img2pdf preservar o tamanho fisico. Sempre colorido — nunca binariza."""
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    buffer = io.BytesIO()
    Image.fromarray(rgb).save(
        buffer, format="JPEG", quality=int(quality), dpi=(dpi, dpi)
    )
    return buffer.getvalue()


def assemble_pdf(jpegs: list[bytes]) -> bytes:
    """Remonta o PDF a partir de JPEGs que ja carregam o proprio DPI (JFIF).
    O layout default do img2pdf le esse DPI por imagem."""
    return img2pdf.convert(jpegs)


def pages_to_pdf(
    pages_bgr: list[np.ndarray], dpi: int = RENDER_DPI, quality: int = JPEG_QUALITY
) -> bytes:
    jpegs: list[bytes] = []
    for bgr in pages_bgr:
        ok, encoded = cv2.imencode(
            ".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality]
        )
        if not ok:
            raise RuntimeError("Falha ao codificar pagina em JPEG.")
        jpegs.append(encoded.tobytes())
    layout = img2pdf.get_fixed_dpi_layout_fun((dpi, dpi))
    return img2pdf.convert(jpegs, layout_fun=layout)
