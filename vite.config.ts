import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // découpage : bibliothèques lourdes et données géographiques séparées du code du jeu (mise en cache navigateur)
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler') || id.includes('node_modules/zustand')) return 'react';
          if (id.includes('world-atlas') || id.includes('topojson')) return 'geo';
          if (id.includes('/src/engine/') || id.includes('/src/data/')) return 'engine';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
