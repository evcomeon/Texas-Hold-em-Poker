#!/bin/bash
# ============================================
# Texas Hold'em Poker - Deployment Script
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DEPLOY_ENV=${1:-production}
COMPOSE_FILE="docker-compose.simple.yml"

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Texas Hold'em Poker Deployment${NC}"
echo -e "${GREEN}  Environment: $DEPLOY_ENV${NC}"
echo -e "${GREEN}============================================${NC}"

# Check if .env file exists
if [ ! -f "server/.env" ]; then
    echo -e "${YELLOW}Warning: server/.env not found. Creating from example...${NC}"
    cp server/.env.example server/.env
    echo -e "${RED}IMPORTANT: Please edit server/.env and set your JWT_SECRET before deploying!${NC}"
    exit 1
fi

# Check for required commands
command -v docker >/dev/null 2>&1 || { echo -e "${RED}Error: docker is required but not installed.${NC}"; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { echo -e "${RED}Error: docker-compose is required but not installed.${NC}"; exit 1; }

# Pull latest changes (if git repo)
if [ -d ".git" ]; then
    echo -e "${YELLOW}Pulling latest changes...${NC}"
    git pull origin feature/multiplayer-lobby || true
fi

# Stop existing containers
echo -e "${YELLOW}Stopping existing containers...${NC}"
docker-compose -f $COMPOSE_FILE down || true

# Build and start
echo -e "${YELLOW}Building and starting containers...${NC}"
docker-compose -f $COMPOSE_FILE up --build -d

# Wait for services to be ready
echo -e "${YELLOW}Waiting for services to be ready...${NC}"
sleep 5

# Health check
echo -e "${YELLOW}Running health check...${NC}"
if curl -s http://localhost/health >/dev/null; then
    echo -e "${GREEN}✓ Deployment successful!${NC}"
    echo -e "${GREEN}  Game available at: http://localhost${NC}"
else
    echo -e "${RED}✗ Health check failed. Check logs with: docker-compose -f $COMPOSE_FILE logs${NC}"
    exit 1
fi

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
