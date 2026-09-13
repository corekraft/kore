FROM node:24.7.0-alpine3.22
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "src/server.ts"]

