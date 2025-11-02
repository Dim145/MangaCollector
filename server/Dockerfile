FROM node:20-alpine

WORKDIR /server

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=2s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

ENV APP_UNSECURE_HEALTHCHECK=false

CMD ["npm", "start"]
