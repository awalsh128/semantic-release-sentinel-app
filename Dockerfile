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
# Don't run as root: the app only reads these files, so a flaw in it or a dependency gets an
# unprivileged user. The node image provides the 'node' user (uid 1000).
USER node
CMD [ "npm", "start" ]
