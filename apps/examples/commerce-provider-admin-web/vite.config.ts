import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../../', '');
  const providerApiBaseUrl = env.VITE_PROVIDER_API_BASE_URL || 'http://localhost:4200';
  const providerAdminPort = Number(env.PROVIDER_ADMIN_UI_PORT || 4210);

  return {
    envDir: '../../../',
    plugins: [react()],
    build: {
      outDir: '../commerce-provider-api/public/dist',
      emptyOutDir: true,
    },
    server: {
      host: '0.0.0.0',
      port: providerAdminPort,
      proxy: {
        '/api/provider-admin': {
          target: providerApiBaseUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
