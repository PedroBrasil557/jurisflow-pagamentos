# Smoke end-to-end do endpoint /enhance (sem rede): gera um PDF de "scan"
# sintetico (pagina com texto e sombra), envia via TestClient e valida o PDF
# devolvido + metricas. Requer `httpx` (dependencia do TestClient):
#   pip install pytest httpx && python tests/smoke_enhance.py

import json

import cv2
import img2pdf
import numpy as np
from fastapi.testclient import TestClient

from app.main import app


def synthetic_scan_pdf() -> bytes:
    page = np.full((1000, 750, 3), 235, dtype=np.uint8)
    for y in range(100, 900, 40):
        page[y : y + 6, 60:690] = 40
    gradient = np.linspace(0.5, 1.0, page.shape[1], dtype=np.float32)
    page = np.clip(page.astype(np.float32) * gradient[None, :, None], 0, 255)
    ok, jpeg = cv2.imencode(".jpg", page.astype(np.uint8))
    assert ok
    return img2pdf.convert([jpeg.tobytes()])


def main() -> None:
    client = TestClient(app)

    health = client.get("/health")
    assert health.status_code == 200, health.text

    response = client.post(
        "/enhance",
        content=synthetic_scan_pdf(),
        headers={"content-type": "application/pdf"},
    )
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"%PDF"), "resposta nao e PDF"

    metrics = json.loads(response.headers["x-enhance-metrics"])
    assert len(metrics) == 1, metrics
    assert metrics[0]["page"] == 1
    assert metrics[0]["sharpnessBefore"] > 0

    # Corpo invalido e rejeitado sem processar.
    bad = client.post("/enhance", content=b"nao-e-pdf")
    assert bad.status_code == 415, bad.status_code

    print("smoke OK:", json.dumps(metrics))


if __name__ == "__main__":
    main()
