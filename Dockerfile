# Office Manager on the firm's own server (VPS) — the application image. Built by docker-compose.yml.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
# Never inside the image: real client data, local secrets, tests.
RUN rm -rf entrainement tests .env .env.* .git .vercel desktop
USER node
EXPOSE 3000
CMD ["node", "server/index.mjs"]
