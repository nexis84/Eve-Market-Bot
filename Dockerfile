FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

USER node
RUN chown -R node:node /app

EXPOSE 8080

CMD ["node", "index.js"]
