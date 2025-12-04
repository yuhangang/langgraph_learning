FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies first for better layer caching
FROM base AS deps
COPY package*.json ./
RUN npm install --omit=dev

# Build stage installs dev dependencies and compiles TS
FROM base AS build
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Final runtime image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy production deps and compiled sources
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
COPY config/ ./config/

EXPOSE 3000
CMD ["node", "dist/main"]
