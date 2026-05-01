import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    hmr: {
      host: '192.168.1.7',
    },
    proxy: {
      '/api': 'http://localhost:3456',
    },
  },
});
