# Modelo DocAligner (deteccao de bordas por IA)

O arquivo **`model.onnx`** servido aqui (`/vendor/docaligner/model.onnx`) é o
**DocAligner heatmap `lcnet100`** (`lcnet100_h_e_bifpn_256_fp32.onnx`, ~4.8 MB):

- Entrada: `img` `[1, 3, 256, 256]` — BGR, normalizado `/255`, layout NCHW.
- Saída: `heatmap` `[1, 4, 128, 128]` — 4 heatmaps (1 por canto), sigmoid.
- Validado ponta a ponta (preprocess + inferência + centroide do maior blob por
  canal). Detecção com confiança ~0.93–0.95 na imagem de teste oficial.

Se este arquivo for removido, o provider **DocAligner** continua funcionando mas
cai automaticamente no motor **OpenCV/jscanify** (degradação graciosa).

## Como foi obtido / como atualizar

Os modelos são distribuídos pelo pacote `docaligner-docsaid` (Google Drive). Para
re-baixar ou trocar de variante, use o `file_id` correspondente:

| Variante | Tipo | Arquivo | file_id (Google Drive) |
|---|---|---|---|
| `lcnet100` | heatmap | `lcnet100_h_e_bifpn_256_fp32.onnx` | `1IlbLPkCv-TdaBLOPh_4J97P1_KHYYJ7a` |
| `fastvit_t8` | heatmap | `fastvit_t8_h_e_bifpn_256_fp32.onnx` | `1W88oOkHjMza6xXbDxrG8k_C-Tf2aYKJ4` |
| `fastvit_sa24` | heatmap (mais preciso/pesado) | `fastvit_sa24_h_e_bifpn_256_fp32.onnx` | `14vUH77v6yGg7zFctUgcT6BzV5Iisg4Dl` |
| `lcnet050` | point (autores: "research only") | `lcnet050_p_multi_decoder_l3_d64_256_fp32.onnx` | `1J7cRuupeEIudYrH_CCSV9WvFfu9JM_qU` |

```bash
pip install gdown
python -c "import gdown; gdown.download(id='1IlbLPkCv-TdaBLOPh_4J97P1_KHYYJ7a', output='model.onnx')"
```

> Todas as variantes heatmap têm a **mesma interface** (entrada 256 BGR/255, saída
> `[1,4,H,W]`), então trocar de modelo é só substituir o `model.onnx` — o código
> lê as dimensões do heatmap em tempo de execução. Só ajuste `config.ts` se mudar
> o tamanho de entrada ou usar o modelo `point`.

## Licença

Confirmar a licença do **DocAligner** (DocsaidLab) para uso comercial antes de
embarcar em produção: https://github.com/DocsaidLab/DocAligner
