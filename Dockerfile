# --- Stage 1: Build & install production dependencies ---
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# --- Stage 2: Final runner image ---
FROM node:22-alpine

WORKDIR /usr/src/app

# Set non-root user for security
USER node

# Copy dependencies and application files with proper ownership
COPY --chown=node:node --from=builder /usr/src/app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node client/ ./client/
COPY --chown=node:node content/ ./content/
COPY --chown=node:node server/ ./server/
COPY --chown=node:node shared/ ./shared/

# Create database directory with proper ownership under root, then revert to node user
USER root
RUN mkdir -p /data && chown -R node:node /data
USER node

# Expose port and configure environment
ENV PORT=8080
ENV T4C_DB=/data/game.db
ENV NODE_ENV=production

EXPOSE 8080

# Command to run the application
CMD ["npm", "start"]
