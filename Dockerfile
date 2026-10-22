# Skywyrm multiplayer server (Cloud Run). The build context is the repo
# root so the server runs the exact simulation modules the browser loads
# from site/js. Only server/ and site/js/ enter the image (see
# .dockerignore). No secrets: on Cloud Run the service account is used.
# Node is pinned to a release so security updates are a visible one-line
# change (and a redeploy): bump it when nodejs.org ships a 22.x security
# release. The tag still gets Debian fixes whenever the image is rebuilt.
FROM node:22.23.4-slim
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY site/js ./site/js
COPY server ./server
USER node
EXPOSE 8080
CMD ["node", "server/server.js"]
