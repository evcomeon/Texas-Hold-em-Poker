# ============================================
# Texas Hold'em Poker - Multi-Stage Dockerfile
# ============================================

# ----------------------------------------
# Stage 1: Build Frontend
# ----------------------------------------
FROM node:20-alpine AS frontend-builder

WORKDIR /app/client

# Copy client package files
COPY client/package*.json ./
RUN npm ci

# Copy client source and build
COPY client/ ./
RUN npm run build

# ----------------------------------------
# Stage 2: Build Backend
# ----------------------------------------
FROM node:20-alpine AS backend

WORKDIR /app/server

# Install dependencies
COPY server/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy backend source
COPY server/ ./

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app/server
USER nodejs

# Expose backend port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Start backend
CMD ["node", "index.js"]

# ----------------------------------------
# Stage 3: Nginx (Full Stack - Frontend + Reverse Proxy)
# ----------------------------------------
FROM nginx:alpine AS fullstack

# Install Node.js for backend in same container
RUN apk add --no-cache nodejs npm

# Copy built frontend
COPY --from=frontend-builder /app/client/dist /usr/share/nginx/html

# Setup backend
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY server/ ./

# Copy Nginx configuration
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx/start.sh /start.sh
RUN chmod +x /start.sh

# Expose port
EXPOSE 80

# Start both nginx and backend
CMD ["/start.sh"]
