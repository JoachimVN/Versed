import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime', 'liquid-glass-react'],
  },
  base: process.env.NODE_ENV === 'production' ? '/versed/' : '/',
  server: {
    host: true,
    port: 5173,
    // If 5173 is already taken (e.g. by another Vite project), fail loudly
    // instead of silently starting on 5174 — Spotify's OAuth redirect_uri is
    // registered against a fixed port, so a silent port shift sends the
    // post-auth redirect to whatever else is listening there instead.
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
