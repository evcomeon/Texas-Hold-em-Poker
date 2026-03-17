#!/bin/bash
# ============================================
# Texas Hold'em Poker - Backup Script
# ============================================

set -e

BACKUP_DIR=${1:-"./backups"}
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="poker_backup_$DATE"

echo "Creating backup: $BACKUP_NAME"

mkdir -p "$BACKUP_DIR"

# Backup game data (if persisted)
# Add your data directories here
# tar -czf "$BACKUP_DIR/$BACKUP_NAME.tar.gz" ./data

# Backup configuration
tar -czf "$BACKUP_DIR/${BACKUP_NAME}_config.tar.gz" \
    ./server/.env \
    ./nginx/ \
    ./docker-compose*.yml \
    ./Dockerfile \
    2>/dev/null || true

echo "Backup created: $BACKUP_DIR/${BACKUP_NAME}_config.tar.gz"

# Cleanup old backups (keep last 7 days)
find "$BACKUP_DIR" -name "poker_backup_*.tar.gz" -mtime +7 -delete 2>/dev/null || true

echo "Backup complete!"
