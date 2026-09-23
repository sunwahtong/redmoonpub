import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    build: {
        // The framework in its own long-lived chunk: it changes rarely, so
        // returning visitors keep it cached across deploys.
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ['react', 'react-dom', 'react-router-dom'],
                    icons: ['lucide-react']
                }
            }
        },
        chunkSizeWarningLimit: 900
    },
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true
            },
            '/assets': {
                target: 'http://localhost:3000',
                changeOrigin: true
            }
        }
    }
});
