FROM node:26 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production

FROM node:26-slim
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends dumb-init && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
VOLUME ["/app/data", "/app/uploads"]
ENV NODE_ENV=production
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
