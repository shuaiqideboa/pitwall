import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The account API runs separately in development (npm run dev:server).
    proxy: { '/api': 'http://localhost:8787' },
  },
});
