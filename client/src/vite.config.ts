import path from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000'

const normalizeApiBaseUrl = (value: string | undefined) => {
    const raw = value?.trim()
    return raw ? raw.replace(/\/+$/, '') : null
}

export default defineConfig(({ command, mode }) => {

    const env = loadEnv(mode, process.cwd(), '')
    const localApiUrl =
        normalizeApiBaseUrl(env.VITE_API_BASE_URL) ??
        normalizeApiBaseUrl(env.VITE_LOCAL_API_URL) ??
        DEFAULT_API_BASE_URL

    return {
        build: {
            outDir: '../../templates',
            assetsDir: 'assets',
            emptyOutDir: false,
        },
        server: {
            host: '127.0.0.1',
            fs: {
                allow: ['..', '../src/'],
            },
            proxy: {
                '/api': {
                    target: localApiUrl,
                    changeOrigin: true,
                },
                '/noodle': {
                    target: localApiUrl,
                    changeOrigin: true,
                },
            },
        },
        optimizeDeps: {
            include: ['react', 'react-dom'],
        },
        plugins: [react(), tailwindcss()],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
            },
        },
        worker: {
            format: 'es',
        },
    }
});
