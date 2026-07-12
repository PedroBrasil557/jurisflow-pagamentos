# Encode-para-caber por pagina: cada pagina nasce no ponto de alta eficiencia
# (300 DPI / q80 — imperceptivel vs q87, bem menor) e SO as paginas mais pesadas
# sao reduzidas, uma de cada vez, ate o documento caber no alvo de bytes. Isso
# maximiza a nitidez das paginas que ja estao enxutas: uma pagina de texto nitida
# nao e penalizada porque outra pagina pesada do mesmo documento estourou o
# orcamento. Preserva cor (JPEG) — NUNCA binariza (RG/CNH sao coloridos).
#
# O realce roda UMA vez, no chamador (main._enhance_fit_pdf); aqui so re-encoda
# o bitmap ja realcado, reescalando quando precisa baixar o DPI. Custo baixo:
# so a pagina que avanca de nivel e re-encodada; as demais ficam em cache.

from .pdf_io import RENDER_DPI, assemble_pdf, downscale_bgr, encode_page_jpeg

# Niveis do melhor (indice 0) ao piso (ultimo), em (dpi, quality). Primeiro
# esgota quality no DPI cheio (bordas de texto sofrem mais com DPI que com
# quality), depois baixa o DPI ja com quality moderada. Piso: 150 DPI / q60.
LEVELS: list[tuple[int, int]] = [
    (300, 80),
    (300, 72),
    (300, 64),
    (260, 70),
    (230, 68),
    (200, 66),
    (175, 62),
    (150, 60),
]
FLOOR_LEVEL = len(LEVELS) - 1


def _encode_at_level(bgr, level: int) -> bytes:
    dpi, quality = LEVELS[level]
    scaled = downscale_bgr(bgr, dpi / RENDER_DPI)
    return encode_page_jpeg(scaled, quality, dpi)


def encode_to_target(enhanced_pages_bgr: list, max_bytes: int) -> tuple[bytes, dict]:
    """Recebe bitmaps JA realcados. Retorna (pdf, metrics). metrics.overBudget
    = True quando nem no piso o documento coube em max_bytes (anexa assim mesmo,
    com aviso — decisao de produto)."""
    page_count = len(enhanced_pages_bgr)
    levels = [0] * page_count
    jpegs = [_encode_at_level(enhanced_pages_bgr[i], 0) for i in range(page_count)]
    total = sum(len(j) for j in jpegs)

    # Guloso: enquanto passa do alvo, reduz a pagina MAIS PESADA que ainda pode
    # reduzir (nao esta no piso). Converge porque cada passo desce um nivel e o
    # piso e finito.
    while total > max_bytes:
        reducible = [i for i in range(page_count) if levels[i] < FLOOR_LEVEL]
        if not reducible:
            break
        heaviest = max(reducible, key=lambda i: len(jpegs[i]))
        levels[heaviest] += 1
        new_jpeg = _encode_at_level(enhanced_pages_bgr[heaviest], levels[heaviest])
        total += len(new_jpeg) - len(jpegs[heaviest])
        jpegs[heaviest] = new_jpeg

    pdf = assemble_pdf(jpegs)
    metrics = {
        "perPage": [
            {
                "dpi": LEVELS[levels[i]][0],
                "quality": LEVELS[levels[i]][1],
                "bytes": len(jpegs[i]),
            }
            for i in range(page_count)
        ],
        "bytesOut": len(pdf),
        # Sobre o alvo (soma dos JPEGs), nao sobre o PDF final: a folga do alvo
        # (abaixo do teto real) absorve o overhead de container do img2pdf.
        "overBudget": total > max_bytes,
    }
    return pdf, metrics
