# Rasterizacao (pypdfium2) e remontagem (img2pdf) do PDF de scan. Cada pagina
# vira um bitmap a 300 DPI, passa pelo realce e volta como JPEG embutido sem
# reencode extra (img2pdf embute o JPEG e fixa o DPI, entao o tamanho fisico da
# pagina e preservado).

import cv2
import img2pdf
import numpy as np
import pypdfium2 as pdfium

RENDER_DPI = 300
JPEG_QUALITY = 87

# Teto do lado longo renderizado (A4 @300 DPI = 3508px + folga). Sem isto, um
# PDF pequeno com MediaBox gigante (ex.: 200x200 pol.) renderizaria a ~60000px
# (~10 GB por pagina) e derrubaria o container por OOM. Acima do teto, o scale
# e reduzido proporcionalmente (a pagina sai menor, nunca estourada).
MAX_RENDER_LONG_EDGE = 4200


class PageLimitError(Exception):
    pass


def rasterize_pdf(pdf_bytes: bytes, max_pages: int) -> list[np.ndarray]:
    doc = pdfium.PdfDocument(pdf_bytes)
    try:
        if len(doc) > max_pages:
            raise PageLimitError(f"PDF com mais de {max_pages} paginas.")
        pages: list[np.ndarray] = []
        for page in doc:
            width_pt, height_pt = page.get_size()
            scale = RENDER_DPI / 72.0
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


def pages_to_pdf(pages_bgr: list[np.ndarray]) -> bytes:
    jpegs: list[bytes] = []
    for bgr in pages_bgr:
        ok, encoded = cv2.imencode(
            ".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]
        )
        if not ok:
            raise RuntimeError("Falha ao codificar pagina em JPEG.")
        jpegs.append(encoded.tobytes())
    layout = img2pdf.get_fixed_dpi_layout_fun((RENDER_DPI, RENDER_DPI))
    return img2pdf.convert(jpegs, layout_fun=layout)
