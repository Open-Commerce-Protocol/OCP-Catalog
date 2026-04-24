import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../', '');
  const centerApiBaseUrl = env.VITE_REGISTRATION_API_BASE_URL || 'http://localhost:4100';
  const registrationAdminPort = Number(env.REGISTRATION_ADMIN_UI_PORT || 4250);

  return {
    envDir: '../../',
    base: './',
    plugins: [react(), tailwindcss()],
    build: {
      outDir: '../ocp-registration-api/public/dist',
      emptyOutDir: true,
    },
    server: {
      host: '0.0.0.0',
      port: registrationAdminPort,
      proxy: {
        '/api/registration-admin': {
          target: centerApiBaseUrl,
          changeOrigin: true,
        },
        '/ocp': {
          target: centerApiBaseUrl,
          changeOrigin: true,
        },
        '/.well-known': {
          target: centerApiBaseUrl,
          changeOrigin: true,
        },
        '/health': {
          target: centerApiBaseUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
