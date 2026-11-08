FROM node:26.13.0-alpine3.24
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "src/server.ts"]

