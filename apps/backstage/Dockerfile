# The platform Backstage (plan 15 step 6): the backend with the Keycloak OIDC
# provider module, the Kubernetes plugin and the catalog, installed from the
# lockfile. Signed and deployed by digest, from a pinned base.
FROM node:26.13.0-alpine3.24@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216
# Links the GHCR package to the public repository so it is published publicly.
LABEL org.opencontainers.image.source="https://github.com/corekraft/kore"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY app-config.yaml ./
COPY src ./src
USER 1000:1000
EXPOSE 7007
CMD ["node", "src/index.js"]
