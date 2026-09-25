FROM docker.m.daocloud.io/library/node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY tsconfig.json nest-cli.json ./
COPY src ./src
COPY data ./data
RUN npm run build

FROM docker.m.daocloud.io/library/node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/data ./data
EXPOSE 3000
CMD ["node", "dist/src/main"]
