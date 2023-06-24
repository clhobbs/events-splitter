# syntax=docker/dockerfile:1

FROM node:18-alpine

ENV APP_MODE target

WORKDIR /
COPY . .
CMD exec node app $APP_MODE