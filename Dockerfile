# Skywyrm multiplayer server (Cloud Run). The build context is the repo
# root so the server runs the exact simulation modules the browser loads
# from site/js. Only server/ and site/js/ enter the image (see
# .dockerignore). No secrets: on Cloud Run the service account is used.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY site/js ./site/js
COPY server ./server
USER node
EXPOSE 8080
CMD ["node", "server/server.js"]
