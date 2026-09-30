# Wyrm multiplayer server (Cloud Run). The build context is the repo root
# so the server runs the exact simulation modules the browser loads from
# docs/wyrm/js. Only wyrm-server/ and docs/wyrm/js/ enter the image (see
# .dockerignore). No secrets: on Cloud Run the service account is used.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY wyrm-server/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY docs/wyrm/js ./docs/wyrm/js
COPY wyrm-server ./wyrm-server
USER node
EXPOSE 8080
CMD ["node", "wyrm-server/server.js"]
