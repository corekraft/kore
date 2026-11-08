FROM node:26.13.0-alpine3.24
# Links the GHCR package to the public repository so it is published publicly.
LABEL org.opencontainers.image.source="https://github.com/corekraft/kore"
WORKDIR /app
COPY package.json ./
COPY src ./src
USER 1000:1000
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "src/server.ts"]

