# The platform Backstage (plan 15 step 6): the backend with the Keycloak OIDC
# provider module, the Kubernetes plugin and the catalog, installed from the
# lockfile. Signed and deployed by digest. The build stage may be anything; the
# runtime stage is distroless (no shell, no package manager), pinned by digest.
FROM node:26.13.0-alpine3.24@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY app-config.yaml ./
COPY src ./src

FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:1d736cf8b5716c07a245301f92717143215d248fd55771ee1936ef4b3302e531
# Links the GHCR package to the public repository so it is published publicly.
LABEL org.opencontainers.image.source="https://github.com/corekraft/kore"
WORKDIR /app
COPY --from=build /app /app
USER 65532:65532
EXPOSE 7007
# The distroless node entrypoint is the node binary; probes use httpGet.
CMD ["src/index.js"]
