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
  // Deployment root. Vercel and custom domains serve from "/", while a
  // GitHub Pages *project* site serves from "/<repo>/" — the Pages workflow
  // sets VITE_BASE accordingly. Runtime asset paths go through
  // `src/tactics/assets.js`, which reads the same value back out of
  // import.meta.env.BASE_URL.
  base: process.env.VITE_BASE || '/',
});
