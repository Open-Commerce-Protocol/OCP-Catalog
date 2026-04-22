import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../../', '');
  const catalogApiBaseUrl = env.VITE_CATALOG_API_BASE_URL || 'http://localhost:4000';
  const catalogAdminPort = Number(env.CATALOG_ADMIN_UI_PORT || 4240);

  return {
    envDir: '../../../',
    plugins: [react(), tailwindcss()],
    build: {
      outDir: '../commerce-catalog-api/public/dist',
      emptyOutDir: true,
    },
    server: {
      host: '0.0.0.0',
      port: catalogAdminPort,
      proxy: {
        '/api/catalog-admin': {
          target: catalogApiBaseUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
