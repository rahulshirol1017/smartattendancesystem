# Stage 1: Build frontend assets
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled frontend from builder
COPY --from=builder /app/dist ./dist

# Copy server and shared application source
COPY server.ts ./
COPY server ./server
COPY src ./src
COPY public ./public
COPY .secure_store ./.secure_store
COPY tsconfig.json ./

# Create storage directories
RUN mkdir -p .local_db .private_uploads .secure_store

EXPOSE 3000

CMD ["npm", "start"]
