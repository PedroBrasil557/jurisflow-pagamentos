# Scanner de documentos (qualidade CamScanner)

Captura de documentos por câmera com detecção de borda, ajuste de cantos,
correção de perspectiva e realce ("cara de escaneado"), gerando um **PDF
multipágina** que entra no fluxo de upload existente (checklist e lote).

## Arquitetura

O componente `<ScanButton>` escolhe o motor em tempo de execução:

- **App nativo** (`Capacitor.isNativePlatform()` verdadeiro): usa o scanner nativo
  do sistema via `@capgo/capacitor-document-scanner` — **VisionKit no iOS** e ML Kit
  no Android. Ver [native-scan.ts](./native-scan.ts).
- **Navegador** (desktop/mobile): usa **jscanify + OpenCV.js** com ajuste manual dos
  4 cantos. Ver [web-scanner-dialog.tsx](./web-scanner-dialog.tsx).

Ambos produzem um `File` PDF via [scan-to-pdf.ts](./scan-to-pdf.ts) e entregam por
`onComplete(file)`. O backend não muda (aceita PDF/qualquer mime até 25 MB).

### Arquivos
- `scan-button.tsx` — botão público; seleciona o motor (lazy import de cada engine).
- `native-scan.ts` — dispara o scanner nativo (VisionKit/ML Kit).
- `web-scanner-dialog.tsx` — scanner no navegador (jscanify, getUserMedia, cantos, filtros).
- `scanner-engine.ts` — carrega OpenCV.js + jscanify sob demanda; detecção de cantos.
- `scan-to-pdf.ts` — monta o PDF multipágina (jspdf). Coberto por testes.

### Vendoring do OpenCV.js
`OpenCV.js` (~8 MB) e `jscanify.js` ficam em `web/public/vendor/` e são carregados
**sob demanda** (somente ao abrir o scanner no navegador), nunca no bundle inicial.

## Setup do app nativo iOS (VisionKit)

Pré-requisitos: **macOS + Xcode** (ou Mac na nuvem: Codemagic / Ionic Appflow /
runner macOS no GitHub Actions) e conta **Apple Developer (US$99/ano)**.

```bash
cd web
# 1. Adicionar a plataforma iOS (gera web/ios). Rodar num Mac.
CAPACITOR_SERVER_URL=https://app.seudominio.com bunx cap add ios
CAPACITOR_SERVER_URL=https://app.seudominio.com bunx cap sync ios

# 2. Abrir no Xcode
bunx cap open ios
```

No `ios/App/App/Info.plist`, adicionar a permissão de câmera:

```xml
<key>NSCameraUsageDescription</key>
<string>Usamos a câmera para escanear documentos e anexá-los ao processo.</string>
```

### Distribuição Ad Hoc (até 100 dispositivos/ano)
1. Cadastrar os UDIDs dos iPhones no portal Apple Developer.
2. Criar um perfil de provisionamento **Ad Hoc** com esses UDIDs.
3. No Xcode, *Archive* → *Distribute App* → *Ad Hoc* → exportar o `.ipa`.
4. Publicar `.ipa` + `manifest.plist` em **HTTPS** e instalar via link
   `itms-services://?action=download-manifest&url=https://.../manifest.plist`
   (ou usar um serviço como TestApp.io).
5. O perfil Ad Hoc expira em ~12 meses — refazer o build e redistribuir.

## Pontos de atenção
- **Sessão/cookie no WebView:** o login (better-auth) usa cookie de sessão; validar
  que persiste no WKWebView ao carregar via `server.url`. Testar cedo.
- **HTTPS em tudo** (sem mixed content) ao carregar a URL remota no app.
- O navegador (jscanify) tem qualidade inferior ao VisionKit; o ajuste manual de
  cantos cobre os casos em que a detecção automática falha.
