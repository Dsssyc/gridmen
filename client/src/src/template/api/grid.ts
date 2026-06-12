import { decodeNodeInfo } from './utils'
import { GridBlockMetaInfo } from '@/core/grid/types'
import { BaseResponse, MultiCellBaseInfo, PatchMeta } from './types'

const API_PREFIX = `/api/grid`
const UNDELETED_FLAG = 0

export const getGridBlockMeta = async (nodeInfo: string, _lockId?: string | null): Promise<GridBlockMetaInfo> => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const url = `${address}${API_PREFIX}/${encodeURIComponent(nodeKey)}/blocks/meta`

    try {
        const response = await fetch(url, { method: 'GET' })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        return await response.json()
    } catch (error) {
        throw new Error(`Failed to get grid block metadata: ${error}`)
    }
}

export const exportGridTopo = async (nodeInfo: string, targetPath: string): Promise<BaseResponse> => {
    const { address, nodeKey } = decodeNodeInfo(nodeInfo)
    const response = await fetch(`${address}${API_PREFIX}/export`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            node_key: nodeKey,
            target_path: targetPath
        })
    })

    return response.json()
}
