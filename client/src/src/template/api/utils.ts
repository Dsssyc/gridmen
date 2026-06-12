import { getEffectiveApiBaseUrl, getSavedApiBaseUrlOverride } from '@/utils/apiBaseUrl'

export function extractIPFromUrl(url: string): string {
    try {
        const urlObj = new URL(url)
        return `${urlObj.hostname}${urlObj.port ? `:${urlObj.port}` : ''}`
    } catch {
        return url.replace(/^https?:\/\//, '')
    }
}

export function decodeNodeInfo(nodeInfo: string): { address: string, nodeKey: string} {
    const isRemote = nodeInfo.includes('::')
    if (isRemote) {
        const [address, nodeKey] = nodeInfo.split('::')
        if (address.startsWith('http://') || address.startsWith('https://')) {
            return { address, nodeKey }
        } else {
            throw new Error(`Invalid address format in nodeInfo: ${nodeInfo}`)
        }
    } else {
        return { address: getLocalApiBaseUrl(), nodeKey: nodeInfo }
    }
}

export function getLocalApiBaseUrl(): string {
    return getEffectiveApiBaseUrl(getSavedApiBaseUrlOverride())
}
