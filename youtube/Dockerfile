# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .

EXPOSE 3021
CMD ["node", "server.js"]
