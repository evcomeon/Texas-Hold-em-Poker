#!/bin/sh
# Start script for fullstack container

# Start backend in background
cd /app/server && node index.js &

# Wait a moment for backend to start
sleep 2

# Start nginx in foreground
nginx -g 'daemon off;'
