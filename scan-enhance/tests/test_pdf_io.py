# Testes do rasterizador/remontador — cobrem os dois bugs pegos no review:
# ordem de canais (pdfium devolve BGR, nao RGB) e OOM por MediaBox gigante.

import cv2
import img2pdf
import numpy as np

from app.enhance import enhance_page
from app.pdf_io import MAX_RENDER_LONG_EDGE, rasterize_pdf


def solid_color_pdf(bgr_color: tuple[int, int, int], dpi: int = 96) -> bytes:
    page = np.zeros((300, 300, 3), dtype=np.uint8)
    page[:, :] = bgr_color
    ok, jpeg = cv2.imencode(".jpg", page)
    assert ok
    layout = img2pdf.get_fixed_dpi_layout_fun((dpi, dpi))
    return img2pdf.convert([jpeg.tobytes()], layout_fun=layout)


def center_pixel(bgr: np.ndarray) -> tuple[int, int, int]:
    h, w = bgr.shape[:2]
    b, g, r = bgr[h // 2, w // 2]
    return int(b), int(g), int(r)


def test_rasterize_preserva_vermelho():
    # Pagina vermelha pura: no BGR de saida, canal R alto e B baixo. Um swap
    # R/B (o bug do COLOR_RGB2BGR sobre buffer ja-BGR) inverte isso.
    pages = rasterize_pdf(solid_color_pdf((0, 0, 255)), 50)
    b, _, r = center_pixel(pages[0])
    assert r > 200 and b < 60


def test_rasterize_preserva_azul():
    pages = rasterize_pdf(solid_color_pdf((255, 0, 0)), 50)
    b, _, r = center_pixel(pages[0])
    assert b > 200 and r < 60


def test_enhance_mantem_matiz_vermelho():
    # O realce ajusta luminancia, nunca croma: vermelho continua vermelho.
    pages = rasterize_pdf(solid_color_pdf((0, 0, 255)), 50)
    out, _ = enhance_page(pages[0])
    b, _, r = center_pixel(out)
    assert r > 150 and r > b + 60


def test_render_limita_dimensoes_de_mediabox_gigante():
    # Imagem de 300px declarada a 1 DPI => pagina de 300x300 polegadas; a 300
    # DPI renderizaria 90000px de lado (~24 GB). O cap reduz o scale.
    pdf = solid_color_pdf((128, 128, 128), dpi=1)
    pages = rasterize_pdf(pdf, 50)
    assert max(pages[0].shape[:2]) <= MAX_RENDER_LONG_EDGE + 1


def test_pagina_normal_nao_e_afetada_pelo_cap():
    # A4-like (300px @96 DPI = ~3.1 pol -> ~938px @300 DPI), bem abaixo do cap.
    pages = rasterize_pdf(solid_color_pdf((128, 128, 128)), 50)
    long_edge = max(pages[0].shape[:2])
    assert 900 <= long_edge <= 950
