FROM node:26.10.0-alpine3.23@sha256:c3c6e314fd42e41962360b2482fc18d150beb47976c3aa7b8b9689d7ef42a5c2 AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

RUN npm run build

FROM nginx:1.31.0-alpine3.23@sha256:2f07d83bf561b506400dc183b1b2003803e39efbd22451f848adaba14d28c7c7
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
