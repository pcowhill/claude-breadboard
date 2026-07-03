import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
