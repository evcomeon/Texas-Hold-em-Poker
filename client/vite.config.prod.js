import { defineConfig } from 'vite';
import { resolve } from 'path';

// Production Vite Configuration
// This config is used for building static files for production deployment

export default defineConfig({
  // Base URL - set to '/' if deploying to root, or '/subdir/' if deploying to subdirectory
  base: '/',
  
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      },
      output: {
        manualChunks: {
          // Separate vendor chunks for better caching
          'socket.io': ['socket.io-client']
        }
      }
    }
  },
  
  // In production, API calls go to same origin (handled by Nginx reverse proxy)
  // Or set VITE_API_URL environment variable for different backend URL
  define: {
    __API_URL__: JSON.stringify(process.env.VITE_API_URL || '/api'),
    __SOCKET_PATH__: JSON.stringify(process.env.VITE_SOCKET_PATH || '/socket.io'),
    __GOOGLE_CLIENT_ID__: JSON.stringify(process.env.VITE_GOOGLE_CLIENT_ID || '')
  }
});
