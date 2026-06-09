// Configuracao do motor DocAligner (deteccao de bordas por IA no navegador).
// Valores alinhados ao modelo embarcado: DocAligner heatmap `lcnet100`
// (lcnet100_h_e_bifpn_256_fp32.onnx). Ao trocar de variante, conferir aqui.

// Caminho do modelo servido localmente (ver public/vendor/docaligner/). Sem o
// arquivo, o detector fica indisponivel e o scanner cai no motor OpenCV
// automaticamente (degradacao graciosa).
export const MODEL_URL = '/vendor/docaligner/model.onnx'

// (Os binarios .wasm/.mjs do onnxruntime-web sao resolvidos pelo Vite via `?url`
// em runtime.ts — nao ficam em public/.)

// Entrada do modelo: 256x256, ordem de canais BGR (convencao OpenCV em que o
// modelo foi treinado), normalizacao apenas /255 (sem mean/std), layout NCHW.
export const INPUT_SIZE = 256

// Saida: 4 heatmaps (1 por canto). Pixel com probabilidade acima deste limiar
// entra no blob do canto; o centroide do maior blob vira o ponto do canto.
// Mais baixo = mais sensivel (documentos brilhantes/em angulo/com reflexo, como
// CNH plastificada, geram heatmaps mais fracos no preview ao vivo).
export const HEATMAP_THRESHOLD = 0.2
