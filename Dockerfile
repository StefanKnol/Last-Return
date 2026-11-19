# Build index.html from src/ (build.js uses only Node built-ins, so no npm install).
FROM node:22-alpine AS build
WORKDIR /app
COPY build.js package.json ./
COPY src ./src
COPY assets ./assets
# There is no git in here, so whoever builds the image says which build this is. Left empty, the game shows
# the version from package.json alone.
ARG LAST_RETURN_BUILD_NUMBER=
ARG LAST_RETURN_BUILD_COMMIT=
RUN node build.js

# Serve the single self-contained page, and keep the lobbies of players who descend together
# (server/server.js). The server needs one package, ws; nothing of the tooling comes along.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY --from=build /app/index.html ./index.html
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/server.js"]
