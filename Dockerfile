# Railway builds with this file instead of its default builder (railpack),
# so a deploy doesn't depend on downloading railpack from GitHub.

# Build: install everything, type-check, bundle the game and the server.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# Run: production dependencies plus the built files only.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
USER node
CMD ["node", "dist-server/index.js"]
