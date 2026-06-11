export const mapboxTokenEnvName = "VITE_MAP_TOKEN"
export const mapboxPublicTokenPrefix = "pk."
export const mapboxSecretTokenPrefix = "sk."

export function normalizeMapboxPublicToken(value: string | null | undefined) {
    const token = String(value ?? '').trim()
    if (!token || token === 'your_mapbox_token_here' || !token.startsWith(mapboxPublicTokenPrefix)) {
        return null
    }
    return token
}

export function isMapboxSecretToken(value: string | null | undefined) {
    return String(value ?? '').trim().startsWith(mapboxSecretTokenPrefix)
}

export function getEnvMapboxAccessToken() {
    return normalizeMapboxPublicToken(import.meta.env.VITE_MAP_TOKEN)
}

export function getMapboxAccessToken(settingsToken?: string | null) {
    const savedToken = String(settingsToken ?? '').trim()
    if (savedToken) {
        return normalizeMapboxPublicToken(savedToken)
    }
    return getEnvMapboxAccessToken()
}
