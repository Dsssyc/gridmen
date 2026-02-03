import { decodeNodeInfo } from './utils'
import { GridBlockMetaInfo } from '@/core/grid/types'
import { BaseResponse, MultiCellBaseInfo, PatchMeta } from './types'

const API_PREFIX = `/api/grid`
const UNDELETED_FLAG = 0

export const exportGridTopo = async (nodeKey: string, filePath: string): Promise<BaseResponse> => {
    const response = await fetch(`${API_PREFIX}/export`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            node_key: nodeKey,
            target_path: filePath,
        }),
    })
    return response.json()
}
