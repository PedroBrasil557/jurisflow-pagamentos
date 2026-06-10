# Producao: imagem oficial do Playwright (Node + Chromium + libs do sistema).
# A versao casa com a do pacote "playwright" no package.json.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# O Chromium ja vem na imagem — nao baixar de novo durante o install.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production

COPY package.json ./
# Apenas dependencias de runtime (playwright + tsx).
RUN npm install --omit=dev

COPY src ./src

# Loop do worker (node --import tsx src/index.ts via script "start").
CMD ["npm", "run", "start"]
