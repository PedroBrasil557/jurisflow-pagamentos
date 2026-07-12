# Testes do encode-para-caber por pagina (fit.encode_to_target): recebe bitmaps
# ja realcados e reduz SO as paginas mais pesadas ate caber no alvo de bytes,
# preservando cor (nunca binariza).

import numpy as np

from app.fit import FLOOR_LEVEL, LEVELS, encode_to_target
from app.pdf_io import rasterize_pdf


def noise_pages(count: int, h: int = 1000, w: int = 800) -> list[np.ndarray]:
    """Paginas de ruido (comprimem mal => bytes reais) com um bloco vermelho
    puro para checar preservacao de cor."""
    rng = np.random.default_rng(0)
    pages = []
    for _ in range(count):
        page = rng.integers(0, 256, size=(h, w, 3), dtype=np.uint8)
        page[100:300, 100:300] = (0, 0, 255)  # BGR: vermelho puro
        pages.append(page)
    return pages


def test_fit_cabe_no_alvo_folgado_sem_reduzir():
    pdf, metrics = encode_to_target(noise_pages(3), 12_000_000)
    assert pdf.startswith(b"%PDF")
    assert metrics["bytesOut"] <= 12_000_000
    assert metrics["overBudget"] is False
    # Nenhuma pagina precisou reduzir: todas no nivel base (300 DPI / q80).
    assert all(p["dpi"] == 300 and p["quality"] == 80 for p in metrics["perPage"])


def test_fit_alvo_impossivel_cai_no_piso_com_over_budget():
    pdf, metrics = encode_to_target(noise_pages(2), 1_000)
    assert pdf.startswith(b"%PDF")
    assert metrics["overBudget"] is True
    floor_dpi, floor_quality = LEVELS[FLOOR_LEVEL]
    assert all(
        p["dpi"] == floor_dpi and p["quality"] == floor_quality
        for p in metrics["perPage"]
    )


def test_fit_reduz_a_pagina_mais_pesada_primeiro():
    # Pagina pesada (ruido) + pagina leve (quase lisa). Com alvo apertado, so a
    # pesada desce de nivel; a leve permanece no topo (nunca e a mais pesada).
    rng = np.random.default_rng(1)
    heavy = rng.integers(0, 256, size=(1600, 1200, 3), dtype=np.uint8)
    light = np.full((1600, 1200, 3), 240, dtype=np.uint8)
    _, metrics = encode_to_target([heavy, light], 300_000)
    assert metrics["perPage"][1]["dpi"] == 300
    assert metrics["perPage"][1]["quality"] == 80
    assert (
        metrics["perPage"][0]["dpi"],
        metrics["perPage"][0]["quality"],
    ) != (300, 80)


def test_fit_nao_binariza_preserva_vermelho():
    pdf, _ = encode_to_target(noise_pages(1), 12_000_000)
    raster = rasterize_pdf(pdf, 50)
    b, _, r = raster[0][200, 200]  # dentro do bloco vermelho
    assert int(r) > 150 and int(r) > int(b) + 60
