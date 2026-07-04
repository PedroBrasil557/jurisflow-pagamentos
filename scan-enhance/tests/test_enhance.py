# Testes das funcoes puras do realce (rodam com `pytest` dentro do container ou
# de um venv com requirements.txt instalado).

import cv2
import numpy as np

from app.enhance import (
    enhance_page,
    flatten_illumination,
    laplacian_variance,
)


def synthetic_document(shadow: bool) -> np.ndarray:
    """Pagina branca com 'texto' (listras) e, opcionalmente, sombra lateral."""
    page = np.full((400, 300, 3), 235, dtype=np.uint8)
    # "Texto": listras horizontais escuras.
    for y in range(40, 360, 20):
        page[y : y + 3, 30:270] = 40
    if shadow:
        # Gradiente de sombra cobrindo a metade esquerda.
        gradient = np.linspace(0.45, 1.0, page.shape[1], dtype=np.float32)
        page = np.clip(page.astype(np.float32) * gradient[None, :, None], 0, 255)
        page = page.astype(np.uint8)
    return page


def background_std(bgr: np.ndarray) -> float:
    """Desvio-padrao do fundo (percentil alto = papel) na luminancia."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    paper = gray[gray > np.percentile(gray, 60)]
    return float(paper.std())


def test_flatten_illumination_reduz_sombra():
    shaded = synthetic_document(shadow=True)
    flattened = flatten_illumination(shaded)
    assert background_std(flattened) < background_std(shaded) * 0.8


def test_flatten_illumination_quase_identidade_sem_sombra():
    clean = synthetic_document(shadow=False)
    flattened = flatten_illumination(clean)
    diff = np.abs(flattened.astype(np.int16) - clean.astype(np.int16)).mean()
    assert diff < 12


def test_enhance_page_metricas_e_nitidez():
    page = synthetic_document(shadow=True)
    out, metrics = enhance_page(page)
    assert out.shape == page.shape
    assert metrics["width"] == page.shape[1]
    assert metrics["height"] == page.shape[0]
    # O unsharp deve elevar (ou ao menos nao derrubar) a metrica de nitidez.
    assert metrics["sharpnessAfter"] >= metrics["sharpnessBefore"] * 0.9


def test_laplacian_variance_ordena_nitido_vs_borrado():
    page = synthetic_document(shadow=False)
    gray = cv2.cvtColor(page, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (0, 0), 3.0)
    assert laplacian_variance(gray) > laplacian_variance(blurred) * 1.5
