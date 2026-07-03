import path from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000'

const normalizePublicBasePath = (value: string | undefined) => {
    const raw = value?.trim()
    if (!raw || raw === '/') return '/'
    const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`
    return `${withLeadingSlash.replace(/\/+$/, '')}/`
}

const normalizeApiBaseUrl = (value: string | undefined) => {
    const raw = value?.trim()
    return raw ? raw.replace(/\/+$/, '') : null
}

const normalizeProxyTarget = (value: string | undefined) => {
    const normalized = normalizeApiBaseUrl(value)
    if (!normalized) return null

    try {
        const url = new URL(normalized)
        return url.protocol === 'http:' || url.protocol === 'https:' ? normalized : null
    } catch {
        return null
    }
}

export default defineConfig(({ command, mode }) => {

    const loadedEnv = loadEnv(mode, process.cwd(), '')
    const envValue = (name: string) => process.env[name] ?? loadedEnv[name]
    const publicBasePath = normalizePublicBasePath(
        envValue('VITE_PUBLIC_BASE_PATH') ?? envValue('VITE_BASE_PATH'),
    )
    const localApiUrl =
        normalizeProxyTarget(envValue('VITE_DEV_API_PROXY_TARGET')) ??
        normalizeProxyTarget(envValue('VITE_LOCAL_API_URL')) ??
        normalizeProxyTarget(envValue('VITE_API_BASE_URL')) ??
        DEFAULT_API_BASE_URL

    return {
        base: publicBasePath,
        build: {
            outDir: '../../templates',
            assetsDir: 'assets',
            emptyOutDir: true,
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
