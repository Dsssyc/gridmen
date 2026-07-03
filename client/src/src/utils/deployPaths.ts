export function normalizePublicBasePath(value: string | null | undefined): string {
    const raw = String(value ?? '').trim()
    if (!raw || raw === '/') return '/'

    const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`
    const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, '')
    return `${withoutTrailingSlash}/`
}

export function getRouterBasename(basePath: string | null | undefined): string | undefined {
    const normalized = normalizePublicBasePath(basePath)
    if (normalized === '/') return undefined
    return normalized.replace(/\/+$/, '')
}

export function withPublicBasePath(path: string, basePath: string | null | undefined = import.meta.env.BASE_URL): string {
    if (/^[a-z][a-z\d+\-.]*:/i.test(path) || path.startsWith('//')) {
        return path
    }

    const normalizedBase = normalizePublicBasePath(basePath)
    const normalizedPath = path.replace(/^\/+/, '')
    return normalizedBase === '/' ? `/${normalizedPath}` : `${normalizedBase}${normalizedPath}`
}
