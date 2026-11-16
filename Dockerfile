FROM node:22-slim AS build
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
# Links the image to this repository on GHCR.
LABEL org.opencontainers.image.source="https://github.com/awalsh128/semantic-release-sentinel-app"
WORKDIR /usr/src/app
ENV NODE_ENV="production"
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /usr/src/app/lib ./lib
CMD [ "npm", "start" ]
