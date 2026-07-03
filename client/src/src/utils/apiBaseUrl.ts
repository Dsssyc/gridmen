export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000'
export const GRIDMEN_SETTINGS_STORAGE_KEY = 'gridmen:settings'
export const apiBaseUrlEnvNames = ['VITE_API_BASE_URL', 'VITE_LOCAL_API_URL'] as const

export type ApiBaseUrlSource = 'settings' | 'runtime' | 'env' | 'default'

let runtimeApiBaseUrlOverride = ''

export function normalizeApiBaseUrl(value: string | null | undefined): string | null {
    const raw = String(value ?? '').trim()
    if (!raw) return null

    if (raw.startsWith('/') && !raw.startsWith('//')) {
        const normalizedPath = raw.replace(/\/+$/, '')
        return normalizedPath || '/'
    }

    try {
        const url = new URL(raw)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    } catch {
        return null
    }

    return raw.replace(/\/+$/, '')
}

export function getEnvApiBaseUrl(): string | null {
    return (
        normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL) ??
        normalizeApiBaseUrl(import.meta.env.VITE_LOCAL_API_URL)
    )
}

export function setRuntimeApiBaseUrlOverride(value: string | null | undefined): void {
    runtimeApiBaseUrlOverride = value ?? ''
}

export function getRuntimeApiBaseUrlOverride(): string {
    return runtimeApiBaseUrlOverride
}

export function getEffectiveApiBaseUrl(settingsOverride?: string | null): string {
    return (
        normalizeApiBaseUrl(settingsOverride) ??
        normalizeApiBaseUrl(runtimeApiBaseUrlOverride) ??
        getEnvApiBaseUrl() ??
        DEFAULT_API_BASE_URL
    )
}

export function getApiBaseUrlSource(settingsOverride?: string | null): ApiBaseUrlSource {
    if (normalizeApiBaseUrl(settingsOverride)) return 'settings'
    if (normalizeApiBaseUrl(runtimeApiBaseUrlOverride)) return 'runtime'
    if (getEnvApiBaseUrl()) return 'env'
    return 'default'
}

export function getSavedApiBaseUrlOverride(): string {
    if (typeof window === 'undefined') return ''

    try {
        const raw = window.localStorage.getItem(GRIDMEN_SETTINGS_STORAGE_KEY)
        if (!raw) return ''

        const parsed = JSON.parse(raw) as { state?: { apiBaseUrlOverride?: unknown } }
        const value = parsed.state?.apiBaseUrlOverride
        return typeof value === 'string' ? value : ''
    } catch {
        return ''
    }
}
