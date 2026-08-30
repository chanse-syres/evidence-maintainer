FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run schemas && npm run lint && npm run build && npm run container:verify

FROM node:24-bookworm-slim AS reviewer
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
CMD ["npm", "run", "container:verify"]
