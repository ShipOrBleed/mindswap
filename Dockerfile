FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY bin ./bin
COPY src ./src
COPY assets ./assets
COPY server.json README.md LICENSE ./

ENV NODE_ENV=production

CMD ["node", "bin/mindswap.js", "mcp"]
