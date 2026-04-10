import proj4 from 'proj4'
import * as apis from '@/template/api/apis'
import Dispatcher from '../message/dispatcher'
import BoundingBox2D from '../util/boundingBox2D'
import { MercatorCoordinate } from '../math/mercatorCoordinate'
import { PatchContext, CellCheckInfo, PatchSaveInfo, MultiCellBaseInfo, StructuredCellRenderVertices, CellKeyHashTable } from './types'

const DELETED_FLAG = 1
const UNDELETED_FLAG = 0

interface PatchLevelInfo {
    width: number
    height: number
}

export interface PatchCoreOptions {
    maxCellNum?: number
    workerCount?: number
    dispatcher?: Dispatcher
}

export default class PatchCore {
    // Patch metadata
    nodeInfo: string
    maxCellNum: number
    levelInfos: PatchLevelInfo[]
    renderRelativeCenter: Float32Array = new Float32Array([0.0, 0.0])

    // Private patch memory cache
    private _lockId: string
    private _nextStorageId = 0
    private _levelCache: Uint8Array
    private _deletedCache: Uint8Array
    private _globalIdCache: Uint32Array
    private _key_storageId_dict: CellKeyHashTable

    // Worker dispatcher
    private _dispatcher: Dispatcher

    constructor(public context: PatchContext, options: PatchCoreOptions = {}) {
        // Init metadata
        this._lockId = context.lockId
        this.nodeInfo = context.nodeInfo
        // this.maxCellNum = options.maxCellNum ?? 4096 * 4096
        this.maxCellNum = options.maxCellNum ?? 25000000
        this.levelInfos = new Array<PatchLevelInfo>(this.context.rules.length)
        this.context.rules.forEach((_, level, rules) => {
            let width: number, height: number
            if (level == 0) {
                width = 1
                height = 1
            } else {
                width = this.levelInfos[level - 1].width * rules[level - 1][0]
                height = this.levelInfos[level - 1].height * rules[level - 1][1]
            }
            this.levelInfos[level] = { width, height }
        })

        // Init dispatcher
        this._dispatcher = new Dispatcher(this, options.workerCount)

        // Init patch cache
        this._levelCache = new Uint8Array(this.maxCellNum)
        this._globalIdCache = new Uint32Array(this.maxCellNum)
        this._key_storageId_dict = new CellKeyHashTable(this.maxCellNum)
        this._deletedCache = new Uint8Array(this.maxCellNum).fill(UNDELETED_FLAG)
    }

    get bBox(): BoundingBox2D {
        return this.context.bBox
    }

    get srcCRS(): string {
        return this.context.srcCS
    }

    get targetCRS(): string {
        return this.context.targetCS
    }

    get cellNum(): number {
        return this._nextStorageId
    }

    get maxLevel(): number {
        return this.levelInfos.length - 1
    }

    init(callback?: Function): void {
        // Get src EPSG code (number type)
        const srcEPSG: number = parseInt(this.srcCRS.split(':')[1])

        // Update proj4 definitions
        apis.proj.getProj4Defs(srcEPSG).then((proj4Defs) => {
            proj4.defs(this.srcCRS, proj4Defs)

            // Calculate bounding box center in mercator coordinates for anti-jitter rendering
            const bBoxCenter: [number, number] = proj4(this.srcCRS, this.targetCRS, this.bBox.center)
            const mercatorCenter = MercatorCoordinate.fromLonLat(bBoxCenter)
            const centerX = encodeFloatToDouble(mercatorCenter[0])
            const centerY = encodeFloatToDouble(mercatorCenter[1])
            this.renderRelativeCenter = new Float32Array([...centerX, ...centerY])

            // Clear next storage ID
            this._nextStorageId = 0

            // Brodcast actors to init patch manager and initialize patch cache
            this._dispatcher.broadcast('setPatchManager', this.context, () => {
                // Get activate patch information
                this._dispatcher.actor.send('getPatchInfo', { nodeInfo: this.nodeInfo, lockId: this._lockId }, (_, baseInfo: MultiCellBaseInfo) => {
                    this.updateMultiCellRenderInfo(baseInfo, callback)
                })
            })
        })
    }

    updateMultiCellRenderInfo(baseInfo: MultiCellBaseInfo, callback?: Function): void {
        // Initialize cell cache
        const cellNum = baseInfo.levels.length
        for (let i = 0; i < cellNum; i++) {
            const storageId = this._nextStorageId + i
            this._key_storageId_dict.update(storageId, baseInfo.levels[i], baseInfo.globalIds[i])
        }

        // Get render vertices of all cells
        this._levelCache.set(baseInfo.levels, this._nextStorageId)
        this._deletedCache.set(baseInfo.deleted!, this._nextStorageId)
        this._globalIdCache.set(baseInfo.globalIds, this._nextStorageId)

        let completedActorNum = 0
        const vertices = new Float32Array(cellNum * 8)
        const verticesLow = new Float32Array(cellNum * 8)
        const actorNum = cellNum < this._dispatcher.actorNum ? 1 : this._dispatcher.actorNum  // avoid abusing too many actors when cellNum is small
        const batchSize = Math.ceil(cellNum / actorNum)
        for (let actorIndex = 0; actorIndex < actorNum; actorIndex++) {
            const fromStorageId = actorIndex * batchSize
            const toStorageId = Math.min(cellNum, (actorIndex + 1) * batchSize)

            // Send cell info batch to actor and get render vertices
            const info: MultiCellBaseInfo = {
                levels: baseInfo.levels.slice(fromStorageId, toStorageId),
                globalIds: baseInfo.globalIds.slice(fromStorageId, toStorageId),
            }
            this._dispatcher.actor.send('getMultiCellRenderVertices', info, (_, renderInfo: StructuredCellRenderVertices) => {
                completedActorNum += 1
                vertices.set(renderInfo.tl, cellNum * 2 * 0 + fromStorageId * 2)
                vertices.set(renderInfo.tr, cellNum * 2 * 1 + fromStorageId * 2)
                vertices.set(renderInfo.bl, cellNum * 2 * 2 + fromStorageId * 2)
                vertices.set(renderInfo.br, cellNum * 2 * 3 + fromStorageId * 2)

                verticesLow.set(renderInfo.tlLow, cellNum * 2 * 0 + fromStorageId * 2)
                verticesLow.set(renderInfo.trLow, cellNum * 2 * 1 + fromStorageId * 2)
                verticesLow.set(renderInfo.blLow, cellNum * 2 * 2 + fromStorageId * 2)
                verticesLow.set(renderInfo.brLow, cellNum * 2 * 3 + fromStorageId * 2)

                // If all actors have completed, make callback
                if (completedActorNum === actorNum) {
                    callback && callback([this._nextStorageId, baseInfo.levels, vertices, verticesLow, baseInfo.deleted])
                    this._nextStorageId += cellNum
                }
            })
        }
    }

    deleteCellLocally(storageId: number, callback?: Function): void {
        const lastStorageId = this._nextStorageId - 1

        // Get render info of this removable cell and the cell having the last storageId
        const lastDeleted = this._deletedCache[lastStorageId]
        const [lastLevel, lastGlobalId] = this.getInfoByStorageId(lastStorageId)
        this._key_storageId_dict.delete(lastLevel, lastGlobalId)
        this._nextStorageId -= 1

        // Do nothing if the removable cell is the cell having the last storageId
        if (this._nextStorageId === storageId) return

        // Replace removable render info with the last render info in the cache
        this._levelCache[storageId] = lastLevel
        this._deletedCache[storageId] = lastDeleted
        this._globalIdCache[storageId] = lastGlobalId
        this._key_storageId_dict.update(storageId, lastLevel, lastGlobalId)
        callback && callback([lastStorageId, storageId])
    }

    deleteCellsLocally(storageIds: number[], callback?: Function): void {
        // Convert removableStorageIds to ascending order and record cells' levels and globalIds which point to
        const removableCellNum = storageIds.length
        const removableLevels = new Array<number>(removableCellNum)
        const removableGlobalIds = new Array<number>(removableCellNum)

        storageIds.sort((a, b) => a - b).forEach((storageId, index) => {
            const [level, globalId] = this.getInfoByStorageId(storageId)
            removableLevels[index] = level
            removableGlobalIds[index] = globalId
        })

        for (let i = 0; i < removableCellNum; i++) {
            this._key_storageId_dict.delete(removableLevels[i], removableGlobalIds[i])
        }

        const maintainedCellNum = this.cellNum - removableCellNum
        const replacedCellNum = maintainedCellNum > removableCellNum ? removableCellNum : maintainedCellNum

        // Generate info cache about replaced cells having last valid storageIds 
        // Note: storageId not pointing to any removable cells is valid
        let replacedStorageId = this._nextStorageId - 1
        const removableIdStack = storageIds.slice()
        const replacedCellInfos = new Array<[storageId: number, level: number, globalId: number, deleted: number]>()
        while (replacedCellInfos.length !== replacedCellNum) {

            // No need to replace removable cells by valid cell infos since they are never be used
            if (storageIds[replacedCellInfos.length] >= this.cellNum) break

            // Check if lastStorageId is one of removable storageIds
            if (removableIdStack.length && removableIdStack[removableIdStack.length - 1] === replacedStorageId) {
                removableIdStack.pop()
            } else {

                // If replacedStorageId is less than removableStorageId, break for replacement not necessary
                if (replacedStorageId <= storageIds[replacedCellInfos.length]) break
                const [lastLevel, lastGlobalId] = this.getInfoByStorageId(replacedStorageId)
                const lastDeleted = this._deletedCache[replacedStorageId]
                replacedCellInfos.push([replacedStorageId, lastLevel, lastGlobalId, lastDeleted])
            }
            replacedStorageId--
        }

        this._nextStorageId -= removableCellNum

        const replacedStorageIds: number[] = []     // source storageIds to be replaced
        const removableStorageIds: number[] = []    // target storageIds to be removed
        storageIds.forEach((storageId, index) => {
            if (index > replacedCellInfos.length - 1) return

            // Replace removable render info with the last render info in the cache
            const [replacedStorageId, replacedLevel, replacedGlobalId, replacedDeleted] = replacedCellInfos[index]
            this._levelCache[storageId] = replacedLevel
            this._deletedCache[storageId] = replacedDeleted
            this._globalIdCache[storageId] = replacedGlobalId
            this._key_storageId_dict.update(storageId, replacedLevel, replacedGlobalId)

            replacedStorageIds.push(replacedStorageId)
            removableStorageIds.push(storageId)
        })
        callback && callback([
            replacedStorageIds,
            removableStorageIds,
        ])
    }

    /**
     * Mark the specified cells as deleted
     * @description: Marks the specified cells as deleted in the patch system.  
     * Not really deleted, but marked as deleted.  
     * For restore operation, the deleted cells must still can be picked up.
     */
    markCellsAsDeleted(removableStorageIds: number[], callback?: Function): void {
        const levels = new Uint8Array(removableStorageIds.length)
        const globalIds = new Uint32Array(removableStorageIds.length)
        for (let i = 0; i < removableStorageIds.length; i++) {
            const storageId = removableStorageIds[i]
            const [level, globalId] = this.getInfoByStorageId(storageId)
            levels[i] = level
            globalIds[i] = globalId
            this._deletedCache[storageId] = DELETED_FLAG
        }
        // Mark provided cells as deleted
        this._dispatcher.actor.send('deleteCells', { levels, globalIds, nodeInfo: this.nodeInfo, lockId: this._lockId }, () => {
            callback && callback()
        })
    }

    restoreCells(restorableStorageIds: number[], callback?: Function): void {
        const levels = new Uint8Array(restorableStorageIds.length)
        const globalIds = new Uint32Array(restorableStorageIds.length)
        for (let i = 0; i < restorableStorageIds.length; i++) {
            const storageId = restorableStorageIds[i]
            const [level, globalId] = this.getInfoByStorageId(storageId)
            levels[i] = level
            globalIds[i] = globalId
            this._deletedCache[storageId] = UNDELETED_FLAG
        }
        // Recover provided cells
        this._dispatcher.actor.send('restoreCells', { levels, globalIds, nodeInfo: this.nodeInfo, lockId: this._lockId }, () => {
            callback && callback()
        })
    }

    /**
     * Subdivide the cells by subdivideInfos  
     * Reason for use subdivideInfos instead of storageIds:  
     * Info stored in cache (indexed by storageIds) of the subdividable cells is replaced because of the previous delete operation,
     * use storageIds to get info of subdividable cells is incorrect.
     */
    subdivideCells(subdivideInfos: { levels: Uint8Array, globalIds: Uint32Array }, callback?: Function): void {
        // Dispatch a worker to subdivide the cells
        this._dispatcher.actor.send('subdivideCells', { ...subdivideInfos, nodeInfo: this.nodeInfo, lockId: this._lockId }, (_, baseInfo: MultiCellBaseInfo) => {
            baseInfo.deleted = new Uint8Array(baseInfo.levels.length).fill(UNDELETED_FLAG)
            this.updateMultiCellRenderInfo(baseInfo, callback)
        })
    }

    mergeCells(mergeableStorageIds: number[], callback?: Function): void {
        const levels = new Uint8Array(mergeableStorageIds.length)
        const globalIds = new Uint32Array(mergeableStorageIds.length)
        for (let i = 0; i < mergeableStorageIds.length; i++) {
            const storageId = mergeableStorageIds[i]
            const [level, globalId] = this.getInfoByStorageId(storageId)
            levels[i] = level
            globalIds[i] = globalId
        }
        // Merge provided cells
        this._dispatcher.actor.send('mergeCells', { levels, globalIds, nodeInfo: this.nodeInfo, lockId: this._lockId }, (_: any, parentInfo: MultiCellBaseInfo) => {
            // Get storageIds of all child cells
            const childStorageIds: number[] = []
            const parentNum = parentInfo.levels.length
            for (let i = 0; i < parentNum; i++) {
                const parentLevel = parentInfo.levels[i]
                const parentGlobalId = parentInfo.globalIds[i]
                const children = this.getChildren(parentLevel, parentGlobalId)
                if (children) {
                    children.forEach((childGlobalId) => {
                        const childStorageId = this._key_storageId_dict.get(parentLevel + 1, childGlobalId)! // ! ensured by backend
                        childStorageIds.push(childStorageId)
                    })
                }
            }
            callback && callback({ childStorageIds, parentInfo })
        })
    }

    getCellInfoByFeature(path: string, callback?: Function) {
        this._dispatcher.actor.send('getCellInfoByFeature', { path, nodeInfo: this.nodeInfo, lockId: this._lockId }, (_, cellInfos: { levels: Uint8Array, globalIds: Uint32Array }) => {
            const { levels, globalIds } = cellInfos
            const cellNum = levels.length
            const storageIds: number[] = new Array(cellNum)
            for (let i = 0; i < cellNum; i++) {
                const id = this._key_storageId_dict.get(levels[i], globalIds[i])! // ! ensured because all activated cells are stored in the cache
                storageIds[i] = id
            }
            callback && callback(storageIds)
        })
    }

    getCellInfoByVectorNode(vectorNodeInfo: string, vectorNodeLockId: string | null, callback?: Function) {
        this._dispatcher.actor.send('getCellInfoByVectorNode', { nodeInfo: this.nodeInfo, lockId: this._lockId, vectorNodeInfo, vectorNodeLockId }, (_, cellInfos: { levels: Uint8Array, globalIds: Uint32Array }) => {
            const { levels, globalIds } = cellInfos
            const cellNum = levels.length
            const storageIds: number[] = new Array(cellNum)
            for (let i = 0; i < cellNum; i++) {
                const id = this._key_storageId_dict.get(levels[i], globalIds[i])! // ! ensured because all activated cells are stored in the cache
                storageIds[i] = id
            }
            callback && callback(storageIds)
        })
    }

    getChildren(level: number, globalId: number): number[] | null {
        if (level >= this.levelInfos.length || level < 0) return null

        const { width: levelWidth } = this.levelInfos[level]
        const globalU = globalId % levelWidth
        const globalV = Math.floor(globalId / levelWidth)

        const [subWidth, subHeight] = this.context.rules[level]
        const subCount = subWidth * subHeight

        const children = new Array<number>(subCount)
        const baseGlobalWidth = levelWidth * subWidth
        for (let localId = 0; localId < subCount; localId++) {
            const subU = localId % subWidth
            const subV = Math.floor(localId / subWidth)

            const subGlobalU = globalU * subWidth + subU
            const subGlobalV = globalV * subHeight + subV
            const subGlobalId = subGlobalV * baseGlobalWidth + subGlobalU
            children[localId] = subGlobalId
        }

        return children
    }

    getInfoByStorageId(storageId: number): [level: number, globalId: number] {
        return [
            this._levelCache[storageId],
            this._globalIdCache[storageId]
        ]
    }

    isDeleted(storageId: number): boolean {
        return this._deletedCache[storageId] === DELETED_FLAG
    }

    getLocalId(level: number, globalId: number) {
        if (level === 0) return 0

        const { width } = this.levelInfos[level]
        const [subWidth, subHeight] = this.context.rules[level - 1]

        const u = globalId % width
        const v = Math.floor(globalId / width)

        return ((v % subHeight) * subWidth) + (u % subWidth)
    }

    check(storageId: number): CellCheckInfo {
        const level = this._levelCache[storageId]
        const globalId = this._globalIdCache[storageId]
        const localId = this.getLocalId(level, globalId)
        const deleted = this._deletedCache[storageId] === DELETED_FLAG

        return {
            storageId,
            level,
            globalId,
            localId,
            deleted
        }
    }

    save(callback: Function) {
        this._dispatcher.actor.send('savePatch', { nodeInfo: this.nodeInfo, lockId: this._lockId }, (_: any, patchInfo: PatchSaveInfo) => {
            callback && callback(patchInfo)
        })
    }

    remove() {
        this._dispatcher.remove()
    }
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function encodeFloatToDouble(value: number) {
    const result = new Float32Array(2)
    result[0] = value
    const delta = value - result[0]
    result[1] = delta
    return result
}
