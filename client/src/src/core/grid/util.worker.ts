import GridManager from './gridManager'
import PatchManager from './patchManager'
import * as api from '@/template/api/apis'
import { setRuntimeApiBaseUrlOverride } from '@/utils/apiBaseUrl'
import { Callback, WorkerSelf } from '../types'
import { PatchContext, GridContext, MultiCellBaseInfo } from './types'

const DELETED_FLAG = 1
const UNDELETED_FLAG = 0

type WorkerContext = WorkerSelf & Record<'patchManager', PatchManager> & Record<'gridManager', GridManager>

export function setApiBaseUrlForWorker(
    apiBaseUrl: string | null,
    callback: Callback<any>
) {
    setRuntimeApiBaseUrlOverride(apiBaseUrl)
    callback()
}

export function setPatchManager(
    this: WorkerContext,
    context: PatchContext,
    callback: Callback<any>
) {
    this.patchManager = new PatchManager(context)
    this.patchManager.init().then(_ => {
        callback()
    })
}

export function setGridManager(
    this: WorkerContext,
    context: GridContext,
    callback: Callback<any>
) {
    this.gridManager = new GridManager(context)
    this.gridManager.init().then(_ => {
        callback()
    })
}

export async function subdivideCells(
    this: WorkerContext,
    gridInfo: { levels: Uint8Array, globalIds: Uint32Array, nodeInfo: string, lockId: string },
    callback: Callback<any>
) {
    const renderInfo = await api.patch.subdivideCells(gridInfo, gridInfo.nodeInfo, gridInfo.lockId)
    callback(null, renderInfo)
}

export async function mergeCells(
    this: WorkerContext,
    gridInfo: { levels: Uint8Array, globalIds: Uint32Array, nodeInfo: string, lockId: string },
    callback: Callback<any>
) {
    const renderInfo = await api.patch.mergeCells(gridInfo, gridInfo.nodeInfo, gridInfo.lockId)
    callback(null, renderInfo)
}

export async function deleteCells(
    gridInfo: { levels: Uint8Array, globalIds: Uint32Array, nodeInfo: string, lockId: string },
    callback: Callback<any>
) {
    await api.patch.deleteCells(gridInfo, gridInfo.nodeInfo, gridInfo.lockId)
    callback()
}

export async function restoreCells(
    gridInfo: { levels: Uint8Array, globalIds: Uint32Array, nodeInfo: string, lockId: string },
    callback: Callback<any>
) {
    await api.patch.restoreCells(gridInfo, gridInfo.nodeInfo, gridInfo.lockId)
    callback()
}

export async function getCellInfoByFeature(
    pickInfo: { path: string, nodeInfo: string, lockId: string },
    callback: Callback<any>
) {
    const result = await api.patch.pickByFeature(pickInfo.path, pickInfo.nodeInfo, pickInfo.lockId)
    callback(null, {
        levels: result.levels,
        globalIds: result.globalIds
    })
}

export async function getCellInfoByVectorNode(
    pickInfo: { nodeInfo: string, lockId: string, vectorNodeInfo: string, vectorNodeLockId: string | null },
    callback: Callback<any>
) {
    const result = await api.patch.pickByVectorNode(
        pickInfo.nodeInfo,
        pickInfo.lockId,
        pickInfo.vectorNodeInfo,
        pickInfo.vectorNodeLockId
    )
    callback(null, {
        levels: result.levels,
        globalIds: result.globalIds
    })
}

export async function getMultiCellRenderVertices(
    this: WorkerSelf & Record<'patchManager', PatchManager>,
    gridInfo: MultiCellBaseInfo,
    callback: Callback<any>
) {
    const result = this.patchManager.createStructuredCellRenderVertices(gridInfo.levels, gridInfo.globalIds)
    callback(null, result)
}

export async function getPatchInfo(
    this: WorkerSelf & Record<'patchManager', PatchManager>,
    data: {
        nodeInfo: string
        lockId: string
    },
    callback: Callback<any>
) {
    const [activateInfoResponse, deletedInfoResponse] = await Promise.all([
        api.patch.activateCellInfo(data.nodeInfo, data.lockId),
        api.patch.deletedCellInfo(data.nodeInfo, data.lockId)
    ])

    // Create combined levels for activate and deleted grids
    const combinedLevels = new Uint8Array(activateInfoResponse.levels.length + deletedInfoResponse.levels.length)
    combinedLevels.set(activateInfoResponse.levels, 0)
    combinedLevels.set(deletedInfoResponse.levels, activateInfoResponse.levels.length)

    // Create combined global IDs for activate and deleted grids
    const combinedGlobalIds = new Uint32Array(activateInfoResponse.globalIds.length + deletedInfoResponse.globalIds.length)
    combinedGlobalIds.set(activateInfoResponse.globalIds, 0)
    combinedGlobalIds.set(deletedInfoResponse.globalIds, activateInfoResponse.globalIds.length)

    // Create a combined deleted flags array
    const combinedDeleted = new Uint8Array(combinedLevels.length)
    combinedDeleted.fill(UNDELETED_FLAG, 0, activateInfoResponse.levels.length)
    combinedDeleted.fill(DELETED_FLAG, activateInfoResponse.levels.length)

    const renderInfo = {
        levels: combinedLevels,
        globalIds: combinedGlobalIds,
        deleted: combinedDeleted,
    }
    callback(null, renderInfo)
}

export async function getGridBlockMeta(
    this: WorkerContext,
    nodeToken: {
        nodeInfo: string
        lockId: string
    },
    callback: Callback<any>
) {

}

export async function getGridBlockInfo(
    this: WorkerSelf & Record<'patchManager', PatchManager>,
    blockInfo: number,
    callback: Callback<any>
) {
    
}

export async function savePatch(
    this: WorkerSelf & Record<'patchManager', PatchManager>,
    data: {
        nodeInfo: string
        lockId: string
    },
    callback: Callback<any>
) {
    const result = await api.patch.savePatch(data.nodeInfo, data.lockId)
    callback(null, result)
}
