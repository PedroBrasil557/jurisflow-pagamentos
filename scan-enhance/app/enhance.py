# Pipeline classico de realce de pagina digitalizada (preserva cor — nunca
# binariza: RG/CNH sao coloridos e tem foto). As tres etapas operam sobre o
# canal L (LAB), mantendo a/b (croma) intactos; a conversao BGR<->LAB acontece
# UMA vez por pagina (as etapas encadeiam L->L):
#
#   1. Achatamento de iluminacao: estima o fundo com blur gaussiano largo
#      (em 1/8 da resolucao, por custo) e normaliza o ganho por pixel — remove
#      sombra suave/gradiente de luz da foto de celular. Ganho limitado
#      ([0.7, 1.5]) para nao criar halo em regioes escuras legitimas (foto 3x4).
#   2. CLAHE leve: contraste local sem estourar.
#   3. Unsharp leve: nitidez percebida do texto.
#
# Estagios de IA (DocAligner p/ refinar cantos, UVDoc p/ dewarp de comprovante
# amassado, DocRes p/ deshadow neural) sao a evolucao planejada — entram aqui
# como novas etapas quando o classico nao bastar (ver README).

import cv2
import numpy as np

# Lado longo da imagem reduzida usada para medir nitidez (mesma convencao do
# gate client-side: variancia do Laplaciano @700px, comparavel entre fontes).
METRIC_LONG_EDGE = 700

# Ganho maximo/minimo do achatamento de iluminacao (protege foto 3x4 e fundos
# escuros legitimos de virarem branco).
GAIN_MIN = 0.7
GAIN_MAX = 1.5


def _metric_gray(bgr: np.ndarray) -> np.ndarray:
    long_edge = max(bgr.shape[:2])
    scale = min(1.0, METRIC_LONG_EDGE / long_edge)
    if scale < 1.0:
        bgr = cv2.resize(
            bgr,
            (max(3, round(bgr.shape[1] * scale)), max(3, round(bgr.shape[0] * scale))),
            interpolation=cv2.INTER_AREA,
        )
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)


def laplacian_variance(gray: np.ndarray) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _flatten_l(l_ch: np.ndarray) -> np.ndarray:
    lf = l_ch.astype(np.float32)

    # Fundo estimado em 1/8 da resolucao (blur largo e caro em 3500px).
    small = cv2.resize(lf, None, fx=0.125, fy=0.125, interpolation=cv2.INTER_AREA)
    sigma = max(small.shape) / 16.0
    bg_small = cv2.GaussianBlur(small, (0, 0), max(sigma, 3.0))
    bg = cv2.resize(bg_small, (lf.shape[1], lf.shape[0]), interpolation=cv2.INTER_LINEAR)

    # Normaliza o fundo para o nivel do papel (percentil alto do proprio fundo):
    # regioes sob sombra (fundo local baixo) recebem ganho > 1.
    target = float(np.percentile(bg, 90))
    gain = np.clip(target / np.maximum(bg, 1.0), GAIN_MIN, GAIN_MAX)
    return np.clip(lf * gain, 0, 255).astype(np.uint8)


def _clahe_l(l_ch: np.ndarray) -> np.ndarray:
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(l_ch)


def _unsharp_l(l_ch: np.ndarray, amount: float = 0.6, sigma: float = 1.2) -> np.ndarray:
    lf = l_ch.astype(np.float32)
    blurred = cv2.GaussianBlur(lf, (0, 0), sigma)
    return np.clip(lf + amount * (lf - blurred), 0, 255).astype(np.uint8)


# Achatamento isolado sobre BGR (usado nos testes; o pipeline de producao usa a
# forma fundida em enhance_page, com uma unica conversao LAB).
def flatten_illumination(bgr: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    return cv2.cvtColor(
        cv2.merge([_flatten_l(l_ch), a_ch, b_ch]), cv2.COLOR_LAB2BGR
    )


def enhance_page(bgr: np.ndarray) -> tuple[np.ndarray, dict]:
    before = laplacian_variance(_metric_gray(bgr))

    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    l_ch = _unsharp_l(_clahe_l(_flatten_l(l_ch)))
    out = cv2.cvtColor(cv2.merge([l_ch, a_ch, b_ch]), cv2.COLOR_LAB2BGR)

    after = laplacian_variance(_metric_gray(out))
    metrics = {
        "sharpnessBefore": round(before, 1),
        "sharpnessAfter": round(after, 1),
        "width": int(out.shape[1]),
        "height": int(out.shape[0]),
    }
    return out, metrics
