import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            // Same-origin from the browser's perspective (Vite proxies + forwards Set-Cookie),
            // so no CORS configuration is needed on the backend. Points at the PHP backend's
            // local dev server - see README.md "PHP/MySQL backend" setup (`php -S
            // localhost:8000` from backend-php/public_html/).
            '/api': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
        },
    },
});
