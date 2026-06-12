import proj4 from 'proj4'
import * as apis from '@/template/api/apis'
import Dispatcher from '../message/dispatcher'
import BoundingBox2D from '../util/boundingBox2D'
import { MercatorCoordinate } from '../math/mercatorCoordinate'
import { GridContext, GridBlockMetaInfo, CellCheckInfo, PatchSaveInfo, MultiCellBaseInfo, StructuredCellRenderVertices, CellKeyHashTable } from './types'

const MAX_BLOCK_NUM = (4096 * 4096) / (1024 * 1024)   // Max 4096 * 4096 cells in GPU, each block has max cells of 1024 * 1024 

export interface GridCoreOptions {
    workerCount?: number
    dispatcher?: Dispatcher
}

export default class GridCore {
    // Node token
    nodeInfo: string
    private _lockId: string

    // Grid metadata
    blockExtents: number[] = []
    renderRelativeCenter: Float32Array = new Float32Array([0.0, 0.0])
    blockSlot: number[] = []   // block index in GPU storage, e.g., [2, 5] means block 2 is stored in GPU storage buffer from 0 - (1024*1024 -1), and block 5 is stored in GPU storage buffer from (1024*1024) - (2*1024*1024 -1)

    // Worker dispatcher
    private _dispatcher: Dispatcher

    constructor(public context: GridContext, options: GridCoreOptions = {}) {
        // Init metadata
        this._lockId = context.lockId
        this.nodeInfo = context.nodeInfo

        // Init dispatcher
        this._dispatcher = new Dispatcher(this, options.workerCount)
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

            // Brodcast actors to init patch manager and initialize patch cache
            this._dispatcher.syncApiBaseUrl(() => {
                this._dispatcher.broadcast('setGridManager', this.context, () => {
                    // Get block metadata
                    apis.grid.getGridBlockMeta(this.nodeInfo, this._lockId).then((blockMeta: GridBlockMetaInfo) => {
                        const blockNum = blockMeta.blockExtents.length / 4
                        for (let i = 0; i < blockNum; i++) {
                            const xMin = blockMeta.blockExtents[i * 4 + 0]
                            const yMin = blockMeta.blockExtents[i * 4 + 1]
                            const xMax = blockMeta.blockExtents[i * 4 + 2]
                            const yMax = blockMeta.blockExtents[i * 4 + 3]

                            // Transform to target CRS
                            const targetBL = proj4(this.srcCRS, this.targetCRS, [xMin, yMin])
                            const targetBR = proj4(this.srcCRS, this.targetCRS, [xMax, yMin])
                            const targetTL = proj4(this.srcCRS, this.targetCRS, [xMin, yMax])
                            const targetTR = proj4(this.srcCRS, this.targetCRS, [xMax, yMax])

                            this.blockExtents.push(...[
                                targetBL[0], targetBL[1],
                                targetBR[0], targetBR[1],
                                targetTL[0], targetTL[1],
                                targetTR[0], targetTR[1],
                            ])
                        }
                    })
                    callback && callback()
                })
            })
        })
    }

    getBlockInScreen(screenExtent: [number, number, number, number]): number[] {
        const blockIndices: number[] = []
        const [screenXMin, screenYMin, screenXMax, screenYMax] = screenExtent

        const blockNum = this.blockExtents.length / 8
        for (let i = 0; i < blockNum; i++) {
            const baseIndex = i * 8
            const blockXMin = Math.min(
                this.blockExtents[baseIndex + 0],
                this.blockExtents[baseIndex + 2],
                this.blockExtents[baseIndex + 4],
                this.blockExtents[baseIndex + 6],
            )
            const blockYMin = Math.min(
                this.blockExtents[baseIndex + 1],
                this.blockExtents[baseIndex + 3],
                this.blockExtents[baseIndex + 5],
                this.blockExtents[baseIndex + 7],
            )
            const blockXMax = Math.max(
                this.blockExtents[baseIndex + 0],
                this.blockExtents[baseIndex + 2],
                this.blockExtents[baseIndex + 4],
                this.blockExtents[baseIndex + 6],
            )
            const blockYMax = Math.max(
                this.blockExtents[baseIndex + 1],
                this.blockExtents[baseIndex + 3],
                this.blockExtents[baseIndex + 5],
                this.blockExtents[baseIndex + 7],
            )

            // AABB overlap test
            if (!(blockXMax < screenXMin || blockXMin > screenXMax || blockYMax < screenYMin || blockYMin > screenYMax)) {
                blockIndices.push(i)
            }
        }

        if (blockIndices.length >= MAX_BLOCK_NUM) return [] // too many blocks, skip block culling
        return blockIndices
    }

    renderCommand(screenExtent: [number, number, number, number]) {
        
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
