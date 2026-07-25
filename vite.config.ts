import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the built game also works from file:// (Electron).
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
