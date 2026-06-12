import { getLocalApiBaseUrl } from './utils'

const API_PREFIX = '/api/proj'

export const getProj4Defs = async (epsg: number): Promise<string> => {
    try {
        const url = `${getLocalApiBaseUrl()}${API_PREFIX}/${epsg}`
        const response = await fetch(url, { method: 'GET' })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const responseData = await response.json()
        return responseData.proj4_defs
    } catch (error) {
        throw new Error(`Failed to get proj4 defs: ${error}`)
    }
}
