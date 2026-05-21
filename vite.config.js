import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Multi-page setup so both `index.html` (landing) and `tactics.html` (React app)
// are produced as separate HTML entries.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        tactics: resolve(__dirname, 'tactics.html'),
      },
    },
  },
  // FPL API: these proxies are public — no rewriting at build time. Keep
  // free of base path surprises.
  base: './',
});
