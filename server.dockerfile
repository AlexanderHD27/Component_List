FROM node:latest

WORKDIR /app
COPY . .
RUN npm install

ENTRYPOINT [ "node", "server.js" ]