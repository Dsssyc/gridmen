import { Map } from 'mapbox-gl'
import { mat4 } from 'gl-matrix'

import '@/App.css'
import PatchCore from '@/core/grid/patchCore'
import VibrantColorGenerator from '@/core/util/vibrantColorGenerator'
import { CellCheckInfo, MultiCellBaseInfo } from '@/core/grid/types'

import gll from '@/core/gl/glLib'
import HitBuffer from './hitBuffer'
import CustomLayerGroup from './customLayerGroup'
import { NHCustomLayerInterface } from './interfaces'
import store from '@/store/store'
import type { TopologyRenderSample } from './renderSample'

let CHECK_ON_EVENT: Function
let CHECK_OFF_EVENT: Function

const LEVEL_PALETTE_LENGTH = 256 // Patch level range is 0 - 255 (UInt8)
const DEFAULT_MAX_CELL_NUM = 4096 * 4096 // 16M cells, a size that most GPUs can handle
type RenderSampleListener = (sample: TopologyRenderSample) => void

export default class TopologyLayer implements NHCustomLayerInterface {
    // Layer-related ///////////////////////////////////////////////////////

    visible = true
    id = 'TopologyLayer'
    type = 'custom' as const
    layerGroup!: CustomLayerGroup

    // Patch-related /////////////////////////////////////////////////////////

    private _patchCore: PatchCore | null = null

    // Interaction-related //////////////////////////////////////////////////

    hitFlag = new Uint8Array([1])   // 0 is a special value and means no selection
    unhitFlag = new Uint8Array([0])
    deletedFlag = new Uint8Array([1])
    undeletedFlag = new Uint8Array([0])
    hitBuffer = new HitBuffer(DEFAULT_MAX_CELL_NUM)

    isTransparent = false
    lastPickedId: number = -1
    private _showDeletedCells = true

    _startCallback: Function = () => { }
    _endCallback: Function = () => { }

    // Box picking context
    private _ctx: CanvasRenderingContext2D | null = null
    private _overlayCanvas: HTMLCanvasElement | null = null;
    private _overlayCtx: CanvasRenderingContext2D | null = null;

    resizeHandler: Function

    // GPU-related ///////////////////////////////////////////////////////

    initialized = false
    paletteColorList: Uint8Array

    private _gl: WebGL2RenderingContext

    // Screen properties
    private _screenWidth: number = 0
    private _screenHeight: number = 0

    // Shader
    private _pickingShader: WebGLProgram = 0
    private _cellMeshShader: WebGLProgram = 0
    private _cellLineShader: WebGLProgram = 0

    // Texture resource
    private _paletteTexture: WebGLTexture = 0

    // Buffer resource
    private _signalBuffer: WebGLBuffer = 0  // [ [isHit], [isDeleted] ]
    private _tlBuffer: WebGLBuffer = 0
    private _trBuffer: WebGLBuffer = 0
    private _blBuffer: WebGLBuffer = 0
    private _brBuffer: WebGLBuffer = 0
    private _tlLowBuffer: WebGLBuffer = 0
    private _trLowBuffer: WebGLBuffer = 0
    private _blLowBuffer: WebGLBuffer = 0
    private _brLowBuffer: WebGLBuffer = 0
    private _levelBuffer: WebGLBuffer = 0
    private _storageVAO: WebGLVertexArrayObject = 0

    // Brush picking pass resource
    private _pickingFBO: WebGLFramebuffer = 0
    private _pickingTexture: WebGLTexture = 0
    private _pickingRBO: WebGLRenderbuffer = 0

    // Box picking pass resource
    private _boxPickingFBO: WebGLFramebuffer = 0
    private _boxPickingTexture: WebGLTexture = 0
    private _boxPickingRBO: WebGLRenderbuffer = 0
    private _renderSampleListeners = new Set<RenderSampleListener>()

    constructor(public map: Map) {
        // Set WebGL2 context
        this._gl = this.map.painter.context.gl

        // Make palette color list
        const colorGenerator = new VibrantColorGenerator()
        this.paletteColorList = new Uint8Array(LEVEL_PALETTE_LENGTH * 3)
        for (let i = 0; i < LEVEL_PALETTE_LENGTH; i++) {
            const color = colorGenerator.nextColor().map(channel => channel * 255.0)
            this.paletteColorList.set(color, i * 3)
        }

        // Bind callbacks and event handlers
        this.resizeHandler = this._resizeHandler.bind(this)

        // Create overlay canvas
        this._overlayCanvas = document.createElement('canvas');
        this._overlayCtx = this._overlayCanvas.getContext('2d');
        this._overlayCanvas.style.top = '0'
        this._overlayCanvas.style.left = '0'
        this._overlayCanvas.style.zIndex = '1'
        this._overlayCanvas.style.position = 'absolute'
        this._overlayCanvas.style.pointerEvents = 'none'

        const mapContainer = this.map.getContainer()
        mapContainer.appendChild(this._overlayCanvas)

        this._resizeOverlayCanvas()
        const resizeObserver = new ResizeObserver(() => this._resizeOverlayCanvas())
        resizeObserver.observe(mapContainer)

        // Bind event handlers for checking switch
        CHECK_ON_EVENT = (() => this.executeClearSelection()).bind(this)
        CHECK_OFF_EVENT = (() => this.executeClearSelection()).bind(this)
    }

    set showDeletedCells(show: boolean) {
        this._showDeletedCells = show
        this.map.triggerRepaint()
    }

    get maxCellNum(): number {
        return this._patchCore?.maxCellNum || DEFAULT_MAX_CELL_NUM
    }

    set patchCore(core: PatchCore) {
        const currentMaxCellNum = this.maxCellNum
        this._patchCore = core // after setting, this.maxCellNum will be updated
        this.startCallback()

        // Update GPU resources if maxCellNum changed
        if (currentMaxCellNum !== this.maxCellNum) {
            this.hitBuffer = new HitBuffer(this.maxCellNum)

            this.initialized = false
            this._removeGPUResource(this._gl)
            this.initGPUResource().then(() => {
                core.init((renderInfo: [number, Uint8Array, Float32Array, Float32Array, Uint8Array]) => {
                    this.updateGPUCells(renderInfo)
                    this.initialized = true
                    this.endCallback()
                })
            })
        } else {
            core.init((renderInfo: [number, Uint8Array, Float32Array, Float32Array, Uint8Array]) => {
                this.updateGPUCells(renderInfo)
                this.initialized = true
                this.endCallback()
            })
        }
    }

    get patchCore(): PatchCore {
        if (!this._patchCore) {
            const err = new Error('PatchCore is not initialized')
            console.error(err)
            throw err
        }
        return this._patchCore
    }

    get isReady() {
        // Check if the patch core is initialized
        if (!this._patchCore || !this._patchCore.cellNum) return false
        // Check if GPU resources are initialized
        if (!this.initialized) return false
        return true
    }

    addRenderSampleListener(listener: RenderSampleListener): () => void {
        this._renderSampleListeners.add(listener)
        return () => this.removeRenderSampleListener(listener)
    }

    removeRenderSampleListener(listener: RenderSampleListener): void {
        this._renderSampleListeners.delete(listener)
    }

    set startCallback(func: Function) {
        this._startCallback = () => {
            func()
            this.map.triggerRepaint()
        }
    }

    get startCallback(): Function {
        return this._startCallback
    }

    set endCallback(func: Function) {
        this._endCallback = () => {
            func()
            this.map.triggerRepaint()
        }
    }

    get endCallback(): Function {
        return this._endCallback
    }

    // Initialization //////////////////////////////////////////////////

    async initialize(_: Map, gl: WebGL2RenderingContext) {
        this._gl = gl
        this.initDOM()
        await this.initGPUResource()
    }

    initDOM() {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'A') {
                this.executePickAllCells()
            }
        })

        // Box Picking Canvas
        let canvas2d = document.querySelector('#canvas2d') as HTMLCanvasElement
        if (!canvas2d) {
            // If canvas2d element not found, create one
            canvas2d = document.createElement('canvas')
            canvas2d.id = 'canvas2d'
            canvas2d.style.position = 'absolute'
            canvas2d.style.top = '0'
            canvas2d.style.left = '0'
            canvas2d.style.pointerEvents = 'none'
            canvas2d.style.zIndex = '1000'
            document.body.appendChild(canvas2d)
        }
        const rect = canvas2d.getBoundingClientRect()
        canvas2d.width = rect.width
        canvas2d.height = rect.height
        this._ctx = canvas2d.getContext('2d')
    }

    async initGPUResource() {
        const gl = this._gl

        gll.enableAllExtensions(gl)

        // Create shader
        await Promise.all([
            gll.createShader(gl, '/shaders/patch/picking.glsl').then(shader => { this._pickingShader = shader }),
            gll.createShader(gl, '/shaders/patch/cellLine.glsl').then(shader => { this._cellLineShader = shader }),
            gll.createShader(gl, '/shaders/patch/cellMesh.glsl').then(shader => { this._cellMeshShader = shader }),
        ])

        // Set static uniform in shaders
        gl.useProgram(this._cellMeshShader)
        gl.uniform1i(gl.getUniformLocation(this._cellMeshShader, 'paletteTexture'), 0)
        gl.useProgram(null)

        // Create storage buffers
        this._storageVAO = gl.createVertexArray()!
        this._tlBuffer = gll.createArrayBuffer(gl, this.maxCellNum * 2 * 4, gl.DYNAMIC_DRAW)!
        this._trBuffer = gll.createArrayBuffer(gl, this.maxCellNum * 2 * 4, gl.DYNAMIC_DRAW)!
        this._blBuffer = gll.createArrayBuffer(gl, this.maxCellNum * 2 * 4, gl.DYNAMIC_DRAW)!
        this._brBuffer = gll.createArrayBuffer(gl, this.maxCellNum * 2 * 4, gl.DYNAMIC_DRAW)!
        this._tlLowBuffer = gll.createArrayBuffer(gl, this.maxCellNum * 2 * 4, gl.DYNAMIC_DRAW)!
        this._trLowBuffer = gll.createArrayBuffer(gl, this.maxCellNum * 2 * 4, gl.DYNAMIC_DRAW)!
        this._blLowBuffer = gll.createArrayBuffer(gl, this.maxCellNum * 2 * 4, gl.DYNAMIC_DRAW)!
        this._brLowBuffer = gll.createArrayBuffer(gl, this.maxCellNum * 2 * 4, gl.DYNAMIC_DRAW)!
        this._levelBuffer = gll.createArrayBuffer(gl, this.maxCellNum * 1 * 1, gl.DYNAMIC_DRAW)!
        this._signalBuffer = gll.createArrayBuffer(gl, this.maxCellNum * 2 * 1, gl.DYNAMIC_DRAW)!

        // Setup VAO
        gl.bindVertexArray(this._storageVAO)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._tlBuffer)
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0)
        gl.enableVertexAttribArray(0)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._trBuffer)
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 2 * 4, 0)
        gl.enableVertexAttribArray(1)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._blBuffer)
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 2 * 4, 0)
        gl.enableVertexAttribArray(2)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._brBuffer)
        gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 2 * 4, 0)
        gl.enableVertexAttribArray(3)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._tlLowBuffer)
        gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 2 * 4, 0)
        gl.enableVertexAttribArray(4)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._trLowBuffer)
        gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 2 * 4, 0)
        gl.enableVertexAttribArray(5)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._blLowBuffer)
        gl.vertexAttribPointer(6, 2, gl.FLOAT, false, 2 * 4, 0)
        gl.enableVertexAttribArray(6)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._brLowBuffer)
        gl.vertexAttribPointer(7, 2, gl.FLOAT, false, 2 * 4, 0)
        gl.enableVertexAttribArray(7)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._levelBuffer)
        gl.vertexAttribIPointer(8, 1, gl.UNSIGNED_BYTE, 1 * 1, 0)
        gl.enableVertexAttribArray(8)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._signalBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, this.maxCellNum, new Uint8Array(this.maxCellNum).fill(this.undeletedFlag[0])) // set all cells to be undeleted
        gl.vertexAttribIPointer(9, 1, gl.UNSIGNED_BYTE, 1 * 1, 0)
        gl.enableVertexAttribArray(9)
        gl.vertexAttribIPointer(10, 1, gl.UNSIGNED_BYTE, 1 * 1, this.maxCellNum)
        gl.enableVertexAttribArray(10)

        gl.vertexAttribDivisor(0, 1)
        gl.vertexAttribDivisor(1, 1)
        gl.vertexAttribDivisor(2, 1)
        gl.vertexAttribDivisor(3, 1)
        gl.vertexAttribDivisor(4, 1)
        gl.vertexAttribDivisor(5, 1)
        gl.vertexAttribDivisor(6, 1)
        gl.vertexAttribDivisor(7, 1)
        gl.vertexAttribDivisor(8, 1)
        gl.vertexAttribDivisor(9, 1)
        gl.vertexAttribDivisor(10, 1)

        gl.bindVertexArray(null)
        gl.bindBuffer(gl.ARRAY_BUFFER, null)

        // Create texture
        this._paletteTexture = gll.createTexture2D(gl, 0, LEVEL_PALETTE_LENGTH, 1, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE)

        // Create picking pass
        this._pickingTexture = gll.createTexture2D(gl, 0, 1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
        this._pickingRBO = gll.createRenderBuffer(gl, 1, 1)
        this._pickingFBO = gll.createFrameBuffer(gl, [this._pickingTexture], 0, this._pickingRBO)!
        this._resizeScreenFBO()

        // Init palette texture
        gll.fillSubTexture2DByArray(gl, this._paletteTexture, 0, 0, 0, LEVEL_PALETTE_LENGTH, 1, gl.RGB, gl.UNSIGNED_BYTE, this.paletteColorList)
    }

    // Picking //////////////////////////////////////////////////

    private _calcPickingMatrix(pos: [number, number]) {
        const canvas = this._gl.canvas as HTMLCanvasElement

        const offsetX = pos[0]
        const offsetY = pos[1]

        const computedStyle = window.getComputedStyle(canvas)
        const canvasWidth = +computedStyle.width.split('px')[0]
        const canvasHeight = +computedStyle.height.split('px')[0]

        const ndcX = offsetX / canvasWidth * 2.0 - 1.0
        const ndcY = 1.0 - offsetY / canvasHeight * 2.0

        const pickingMatrix = mat4.create()
        mat4.scale(pickingMatrix, pickingMatrix, [canvasWidth * 0.5, canvasHeight * 0.5, 1.0])
        mat4.translate(pickingMatrix, pickingMatrix, [-ndcX, -ndcY, 0.0])

        return pickingMatrix
    }

    /**
     * @param pickingMatrix 
     * @returns { number } StorageId of the picked cell
     */
    private _brushPicking(pickingMatrix: mat4): number {
        const gl = this._gl

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._pickingFBO)
        gl.viewport(0, 0, 1, 1)

        gl.clearColor(1.0, 1.0, 1.0, 1.0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

        gl.disable(gl.BLEND)

        gl.depthFunc(gl.LESS)
        gl.enable(gl.DEPTH_TEST)

        gl.useProgram(this._pickingShader)

        gl.bindVertexArray(this._storageVAO)
        gl.uniform2fv(gl.getUniformLocation(this._pickingShader, 'centerHigh'), [this.layerGroup.mercatorCenterX[0], this.layerGroup.mercatorCenterY[0]])
        gl.uniform2fv(gl.getUniformLocation(this._pickingShader, 'centerLow'), [this.layerGroup.mercatorCenterX[1], this.layerGroup.mercatorCenterY[1]])
        gl.uniformMatrix4fv(gl.getUniformLocation(this._pickingShader, 'pickingMatrix'), false, pickingMatrix)
        gl.uniform4fv(gl.getUniformLocation(this._pickingShader, 'relativeCenter'), this.patchCore.renderRelativeCenter)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._pickingShader, 'uMatrix'), false, this.layerGroup.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.patchCore.cellNum)

        gl.flush()

        const pixel = new Uint8Array(4)
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)

        // Return storageId of the picked cell
        return pixel[0] + (pixel[1] << 8) + (pixel[2] << 16) + (pixel[3] << 24)
    }

    private _boxPicking(pickingBox: number[]) {
        const gl = this._gl
        const canvas = gl.canvas as HTMLCanvasElement
        const computedStyle = window.getComputedStyle(canvas)
        const canvasWidth = +computedStyle.width.split('px')[0]
        const canvasHeight = +computedStyle.height.split('px')[0]

        this._resizeScreenFBO()
        const minx = Math.min(pickingBox[0], pickingBox[2])
        const miny = Math.max(pickingBox[1], pickingBox[3])
        const maxx = Math.max(pickingBox[0], pickingBox[2])
        const maxy = Math.min(pickingBox[1], pickingBox[3])

        const [startX, startY, endX, endY] = [minx, miny, maxx, maxy]

        const pixelX = (startX)
        const pixelY = (canvasHeight - startY - 1)
        const pixelEndX = (endX)
        const pixelEndY = (canvasHeight - endY - 1)
        const width = Math.floor(pixelEndX - pixelX)
        const height = Math.floor(pixelEndY - pixelY)

        const boxPickingMatrix = mat4.create()

        this._boxPickingTexture = gll.createTexture2D(gl, 0, gl.canvas.width, gl.canvas.height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(gl.canvas.width * gl.canvas.height * 4).fill(0))
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._boxPickingFBO)
        gl.viewport(0, 0, canvasWidth, canvasHeight)

        gl.clearColor(1.0, 1.0, 1.0, 1.0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

        gl.disable(gl.BLEND)

        gl.depthFunc(gl.LESS)
        gl.enable(gl.DEPTH_TEST)

        gl.useProgram(this._pickingShader)

        gl.bindVertexArray(this._storageVAO)

        gl.uniform2fv(gl.getUniformLocation(this._pickingShader, 'centerHigh'), [this.layerGroup.mercatorCenterX[0], this.layerGroup.mercatorCenterY[0]])
        gl.uniform2fv(gl.getUniformLocation(this._pickingShader, 'centerLow'), [this.layerGroup.mercatorCenterX[1], this.layerGroup.mercatorCenterY[1]])
        gl.uniformMatrix4fv(gl.getUniformLocation(this._pickingShader, 'pickingMatrix'), false, boxPickingMatrix)
        gl.uniform4fv(gl.getUniformLocation(this._pickingShader, 'relativeCenter'), this.patchCore.renderRelativeCenter)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._pickingShader, 'uMatrix'), false, this.layerGroup.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.patchCore.cellNum)

        gl.flush()

        const pixel = new Uint8Array(4 * width * height)
        gl.readPixels(pixelX, pixelY, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)

        const set = new Set<number>()
        for (let i = 0; i < height; i += 1) {
            for (let j = 0; j < width; j += 1) {
                const pixleId = 4 * (i * width + j)
                const storageId = pixel[pixleId] + (pixel[pixleId + 1] << 8) + (pixel[pixleId + 2] << 16) + (pixel[pixleId + 3] << 24)
                if (storageId < 0 || set.has(storageId)) continue
                set.add(storageId)
            }
        }
        return Array.from(set)
    }

    /**
     * @description: Update hit set and make cells in hitset highlight (hit) or unhighlight (unhit)
     */
    private _hit(storageIds: number | number[], addMode = true) {
        const gl = this._gl
        gl.bindBuffer(gl.ARRAY_BUFFER, this._signalBuffer)

        const ids = Array.isArray(storageIds) ? storageIds : [storageIds]
        if (addMode) {
            // Highlight all cells
            if (ids.length === this.patchCore.cellNum) {

                this.hitBuffer.all = ids
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Uint8Array(this.maxCellNum).fill(this.hitFlag[0]))

            } else {
                ids.forEach(storageId => {
                    if (storageId < 0) return
                    this.hitBuffer.add(storageId)
                    gl.bufferSubData(gl.ARRAY_BUFFER, storageId, this.hitFlag, 0)
                })
            }
        } else {
            // Unhighlight all cells
            ids.forEach(storageId => {
                if (storageId < 0) return

                if (this.hitBuffer.isHit(storageId)) {
                    this.hitBuffer.remove(storageId)
                    gl.bufferSubData(gl.ARRAY_BUFFER, storageId, this.unhitFlag, 0)
                }
            })
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, null)
        this.map.triggerRepaint()
    }

    private _updateHitFlag() {
        // Reset hitBuffer (Max number of hit flag is 255)
        if (this.hitFlag[0] === 255) {
            const gl = this._gl
            gl.bindBuffer(gl.ARRAY_BUFFER, this._signalBuffer)
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Uint8Array(this.maxCellNum).fill(0))
            gl.bindBuffer(gl.ARRAY_BUFFER, null)
            this.hitFlag[0] = 0
        }
        this.hitFlag[0] = this.hitFlag[0] + 1
    }

    /**
     * type: 0 - box, 1 - brush, 2 - feature
     * mode: true - add, false - remove
     */
    executePickCells(type: string, mode: boolean, startPos: [number, number], endPos?: [number, number]) {
        this.startCallback()
        let storageIds
        if (type === 'box') {
            const box = genPickingBox(startPos, endPos!)
            storageIds = this._boxPicking(box)
        } else if (type === 'brush') {
            storageIds = this._brushPicking(this._calcPickingMatrix(startPos))
        } else if (type === 'feature') {
            // Implement feature picking logic through interface: executePickCellsByFeature
        } else {
            this.endCallback()
            return
        }
        this._hit(storageIds!, mode)
        this.endCallback()
    }

    executeCheckCell(startPos: [number, number]): CellCheckInfo | null {
        // Clear hit set
        this.executeClearSelection()

        // Get checkable cell
        const storageId = this._brushPicking(this._calcPickingMatrix(startPos))
        if (storageId < 0) return null

        // Highlight cell
        this._hit(storageId)
        this.map.triggerRepaint()

        // Check information
        return this.patchCore.check(storageId)
    }

    executePickCellsByFeature(path: string, addMode = true) {
        this.startCallback()
        this.patchCore.getCellInfoByFeature(path, (storageIds: number[]) => {
            this._hit(storageIds, addMode)
            this.endCallback()
            store.get<{ on: Function; off: Function }>('isLoading')!.off()
        })
    }

    executePickCellsByVectorNode(vectorNodeInfo: string, vectorNodeLockId: string | null, addMode = true) {
        this.startCallback()
        this.patchCore.getCellInfoByVectorNode(vectorNodeInfo, vectorNodeLockId, (storageIds: number[]) => {
            this._hit(storageIds, addMode)
            this.endCallback()
            store.get<{ on: Function; off: Function }>('isLoading')!.off()
        })
    }

    executePickAllCells() {
        this.startCallback()
        const storageIds = new Array<number>()
        for (let i = 0; i < this.patchCore.cellNum; i++) {
            storageIds.push(i)
        }
        this._hit(storageIds)
        this.endCallback()
    }

    /**
     * @description: Clear the current selection and return storageIds of picked cells
     */
    executeClearSelection(): number[] {
        const pickedStorageIds = this.hitBuffer.clear()
        this._updateHitFlag()
        this.map.triggerRepaint()
        return pickedStorageIds
    }

    // Delete cells  //////////////////////////////////////////////////

    deleteCellsLocally(storageIds: number[]) {
        if (storageIds.length === 0) return
        this.startCallback()

        if (storageIds.length === 1) {
            // Fast delete for single cell
            this.patchCore.deleteCellLocally(storageIds[0], (info: [sourceStorageId: number, targetStorageId: number]) => {
                this.copyGPUCell(info[0], info[1])
                this.endCallback()
            })
        } else {
            this.patchCore.deleteCellsLocally(storageIds, (infos: [sourceStorageIds: number[], targetStorageIds: number[]]) => {
                for (let i = 0; i < infos[0].length; i++) {
                    this.copyGPUCell(infos[0][i], infos[1][i])
                }
                this.endCallback()
            })
        }
    }

    deleteCells(storageIds: number[]) {
        if (storageIds.length === 0) return
        this.startCallback()

        const gl = this._gl

        // Set cells deleted
        this.patchCore.markCellsAsDeleted(storageIds, () => {
            gl.bindBuffer(gl.ARRAY_BUFFER, this._signalBuffer)
            storageIds.forEach(storageId => {
                gl.bufferSubData(gl.ARRAY_BUFFER, this.maxCellNum + storageId, this.deletedFlag, 0)
            })
            gl.bindBuffer(gl.ARRAY_BUFFER, null)
            this._hit(storageIds)
            this.endCallback()
        })
    }

    restoreCells(storageIds: number[]) {
        if (storageIds.length === 0) return
        this.startCallback()

        const gl = this._gl

        // Set cells undeleted
        this.patchCore.restoreCells(storageIds, () => {
            gl.bindBuffer(gl.ARRAY_BUFFER, this._signalBuffer)
            storageIds.forEach(storageId => {
                gl.bufferSubData(gl.ARRAY_BUFFER, this.maxCellNum + storageId, this.undeletedFlag, 0)
            })
            gl.bindBuffer(gl.ARRAY_BUFFER, null)
            this._hit(storageIds)
            this.endCallback()
        })
    }

    executeDeleteCells() {
        const removableStorageIds = this.executeClearSelection()
            .filter(removableStorageId => !this._patchCore!.isDeleted(removableStorageId))
        this.deleteCells(removableStorageIds)
    }

    executeRecoverCells() {
        const recoverableStorageIds = this.executeClearSelection()
            .filter(recoverableStorageId => this._patchCore!.isDeleted(recoverableStorageId))
        this.restoreCells(recoverableStorageIds)
    }

    // Subdivide cells  //////////////////////////////////////////////////

    private _subdivideCells(subdivideInfos: { levels: Uint8Array, globalIds: Uint32Array }) {
        if (subdivideInfos.levels.length === 0) return
        this.startCallback()

        this.patchCore.subdivideCells(subdivideInfos, (renderInfos: any) => {
            this.updateGPUCells(renderInfos)
            const [fromStorageId, levels] = renderInfos
            const storageIds = Array.from(
                { length: levels.length },
                (_, i) => fromStorageId + i
            )
            this._hit(storageIds)
            this.endCallback()
        })
    }

    private _mergeCells(mergeableStorageIds: number[]) {
        if (mergeableStorageIds.length === 0) return
        this.startCallback()

        // Merge cells
        this.patchCore.mergeCells(mergeableStorageIds, (info: { childStorageIds: number[], parentInfo: MultiCellBaseInfo }) => {
            // If no parent cell is provided, just hit the mergable cells and do nothing
            if (info.parentInfo.levels.length === 0) {
                this._hit(mergeableStorageIds)
                this.endCallback()
            }
            // Delete child cells locally
            this.patchCore.deleteCellsLocally(info.childStorageIds, (infos: [sourceStorageIds: number[], targetStorageIds: number[]]) => {
                for (let i = 0; i < infos[0].length; i++) {
                    this.copyGPUCell(infos[0][i], infos[1][i])
                }

                const fromStorageId = this.patchCore.cellNum
                // Update parent cell in cell core and GPU resources
                this.patchCore.updateMultiCellRenderInfo(info.parentInfo, (renderInfo: any) => {
                    this.updateGPUCells(renderInfo)

                    // Pick all merged cells
                    const storageIds = Array.from(
                        { length: info.parentInfo.levels.length },
                        (_, i) => fromStorageId + i
                    )
                    this._hit(storageIds)
                    this.endCallback()
                })
            })
        })
    }

    executeSubdivideCells() {
        const subdivideLevels: number[] = []
        const subdivideGlobalIds: number[] = []
        const subdividableStorageIds = this.executeClearSelection()
            .filter(removableStorageId => {
                const level = this.patchCore.getInfoByStorageId(removableStorageId)[0]
                const isValid = (level !== this.patchCore.maxLevel) && (!this._patchCore!.isDeleted(removableStorageId))
                if (isValid) {
                    subdivideLevels.push(level)
                    const globalId = this.patchCore.getInfoByStorageId(removableStorageId)[1]
                    subdivideGlobalIds.push(globalId)
                }
                return isValid
            })
        const subdivideInfo = {
            levels: new Uint8Array(subdivideLevels),
            globalIds: new Uint32Array(subdivideGlobalIds)
        }
        this.deleteCellsLocally(subdividableStorageIds)
        this._subdivideCells(subdivideInfo)
        store.get<{ on: Function; off: Function }>('isLoading')!.off()
    }

    executeMergeCells() {
        const mergeableStorageIds = this.executeClearSelection()
            .filter(mergeableStorageId => !this._patchCore!.isDeleted(mergeableStorageId))
        this._mergeCells(mergeableStorageIds)
        store.get<{ on: Function; off: Function }>('isLoading')!.off()
    }

    // Rendering ///////////////////////////////////////////////////

    render(gl: WebGL2RenderingContext, matrix: number[]) {
        // Skip if not ready or not visible
        if (!this.isReady || !this.visible) return

        const renderStartMs = performance.now()
        let passCount = 0

        // Tick render
        if (!this.isTransparent) {
            // Mesh Pass
            this.drawCellMeshes()
            passCount += 1
            // Line Pass
            this.drawCellLines()
            passCount += 1
        }

        // Error check
        gll.errorCheck(gl)

        const renderEndMs = performance.now()
        this.emitRenderSample({
            timestampMs: renderEndMs,
            renderDurationMs: renderEndMs - renderStartMs,
            cellCount: this.patchCore.cellNum,
            layerId: this.id,
            passCount,
            visible: this.visible,
        })
    }

    private emitRenderSample(sample: TopologyRenderSample): void {
        this._renderSampleListeners.forEach(listener => listener(sample))
    }

    drawCellMeshes() {
        const gl = this._gl

        gl.enable(gl.BLEND)
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LESS)

        gl.useProgram(this._cellMeshShader)

        gl.bindVertexArray(this._storageVAO)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this._paletteTexture)
        gl.uniform1i(gl.getUniformLocation(this._cellMeshShader, 'hit'), this.hitFlag[0])
        gl.uniform1i(gl.getUniformLocation(this._cellMeshShader, 'showDeleted'), this._showDeletedCells ? 1 : 0)
        gl.uniform2fv(gl.getUniformLocation(this._cellMeshShader, 'centerHigh'), [this.layerGroup.mercatorCenterX[0], this.layerGroup.mercatorCenterY[0]])
        gl.uniform2fv(gl.getUniformLocation(this._cellMeshShader, 'centerLow'), [this.layerGroup.mercatorCenterX[1], this.layerGroup.mercatorCenterY[1]])
        gl.uniform1f(gl.getUniformLocation(this._cellMeshShader, 'mode'), 0.0)
        gl.uniform4fv(gl.getUniformLocation(this._cellMeshShader, 'relativeCenter'), this.patchCore.renderRelativeCenter)
        gl.uniformMatrix4fv(gl.getUniformLocation(this._cellMeshShader, 'uMatrix'), false, this.layerGroup.relativeEyeMatrix)

        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.patchCore.cellNum)

        gl.disable(gl.BLEND)
    }

    drawCellLines() {
        const gl = this._gl

        gl.disable(gl.DEPTH_TEST)

        gl.enable(gl.BLEND)
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

        gl.useProgram(this._cellLineShader)

        gl.bindVertexArray(this._storageVAO)

        gl.uniform1i(gl.getUniformLocation(this._cellLineShader, 'showDeleted'), this._showDeletedCells ? 1 : 0)
        gl.uniform2fv(gl.getUniformLocation(this._cellLineShader, 'centerHigh'), [this.layerGroup.mercatorCenterX[0], this.layerGroup.mercatorCenterY[0]])
        gl.uniform2fv(gl.getUniformLocation(this._cellLineShader, 'centerLow'), [this.layerGroup.mercatorCenterX[1], this.layerGroup.mercatorCenterY[1]])
        gl.uniformMatrix4fv(gl.getUniformLocation(this._cellLineShader, 'uMatrix'), false, this.layerGroup.relativeEyeMatrix)
        gl.uniform4fv(gl.getUniformLocation(this._cellLineShader, 'relativeCenter'), this.patchCore.renderRelativeCenter)

        gl.drawArraysInstanced(gl.LINE_LOOP, 0, 4, this.patchCore.cellNum)

        gl.disable(gl.BLEND)
    }

    // GPU update //////////////////////////////////////////////////

    // Fast function to upload one cell rendering info to GPU stograge buffer
    private _writeCellInfoToStorageBuffer(info: [storageId: number, level: number, vertices: Float32Array, verticesLow: Float32Array, deleted: number]) {
        const gl = this._gl
        const levelByteStride = 1 * 1
        const vertexByteStride = 2 * 4
        const [storageId, level, vertices, verticesLow, deleted] = info

        gl.bindBuffer(gl.ARRAY_BUFFER, this._tlBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * vertexByteStride, vertices, 0, 2)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._trBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * vertexByteStride, vertices, 2, 2)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._blBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * vertexByteStride, vertices, 4, 2)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._brBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * vertexByteStride, vertices, 6, 2)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._tlLowBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * vertexByteStride, verticesLow, 0, 2)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._trLowBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * vertexByteStride, verticesLow, 2, 2)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._blLowBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * vertexByteStride, verticesLow, 4, 2)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._brLowBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * vertexByteStride, verticesLow, 6, 2)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._levelBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, storageId * levelByteStride, new Uint8Array([level]), 0, 1)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._signalBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, this.maxCellNum * 1 + storageId, new Uint8Array([deleted]), 0, 1)

        gl.bindBuffer(gl.ARRAY_BUFFER, null)
    }

    private _copyCellInBuffer(sourceStorageId: number, targetStorageId: number) {
        const gl = this._gl
        const levelByteStride = 1 * 1
        const vertexByteStride = 2 * 4

        const buffers = [
            this._tlBuffer,
            this._trBuffer,
            this._blBuffer,
            this._brBuffer,
            this._tlLowBuffer,
            this._trLowBuffer,
            this._blLowBuffer,
            this._brLowBuffer
        ]

        buffers.forEach(buffer => {
            gl.bindBuffer(gl.COPY_READ_BUFFER, buffer)
            gl.bindBuffer(gl.COPY_WRITE_BUFFER, buffer)
            gl.copyBufferSubData(
                gl.COPY_READ_BUFFER,
                gl.COPY_WRITE_BUFFER,
                sourceStorageId * vertexByteStride,
                targetStorageId * vertexByteStride,
                vertexByteStride
            )
        })

        gl.bindBuffer(gl.COPY_READ_BUFFER, this._levelBuffer)
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, this._levelBuffer)
        gl.copyBufferSubData(
            gl.COPY_READ_BUFFER,
            gl.COPY_WRITE_BUFFER,
            sourceStorageId * levelByteStride,
            targetStorageId * levelByteStride,
            levelByteStride
        )

        gl.bindBuffer(gl.COPY_READ_BUFFER, this._signalBuffer)
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, this._signalBuffer)
        gl.copyBufferSubData(
            gl.COPY_READ_BUFFER,
            gl.COPY_WRITE_BUFFER,
            this.maxCellNum + sourceStorageId,
            this.maxCellNum + targetStorageId,
            1
        )

        gl.bindBuffer(gl.COPY_READ_BUFFER, null)
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, null)
    }

    updateGPUCell(info?: [storageId: number, level: number, vertices: Float32Array, verticesLow: Float32Array, deleted: number]) {
        if (info) {
            this._writeCellInfoToStorageBuffer(info)
            this._gl.flush()
        }

        this.map.triggerRepaint()
    }

    copyGPUCell(sourceStorageId: number, targetStorageId: number) {
        this._copyCellInBuffer(sourceStorageId, targetStorageId)
        this._gl.flush()
        this.map.triggerRepaint()
    }

    // Optimized function to upload multiple cell rendering info to GPU storage buffer
    // Note: cells must have continuous storageIds from 'storageId' to 'storageId + cellNum'
    private _writeMultiCellInfoToStorageBuffer(infos: [fromStorageId: number, levels: Uint8Array, vertices: Float32Array, verticesLow: Float32Array, deleteds: Uint8Array]) {

        const gl = this._gl
        const [fromStorageId, levels, vertices, verticesLow, deleteds] = infos
        const levelByteStride = 1 * 1
        const vertexByteStride = 2 * 4
        const cellNum = vertices.length / 8
        const lengthPerAttribute = 2 * cellNum

        gl.bindBuffer(gl.ARRAY_BUFFER, this._tlBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * vertexByteStride, vertices, lengthPerAttribute * 0, lengthPerAttribute)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._trBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * vertexByteStride, vertices, lengthPerAttribute * 1, lengthPerAttribute)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._blBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * vertexByteStride, vertices, lengthPerAttribute * 2, lengthPerAttribute)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._brBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * vertexByteStride, vertices, lengthPerAttribute * 3, lengthPerAttribute)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._tlLowBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * vertexByteStride, verticesLow, lengthPerAttribute * 0, lengthPerAttribute)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._trLowBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * vertexByteStride, verticesLow, lengthPerAttribute * 1, lengthPerAttribute)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._blLowBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * vertexByteStride, verticesLow, lengthPerAttribute * 2, lengthPerAttribute)
        gl.bindBuffer(gl.ARRAY_BUFFER, this._brLowBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * vertexByteStride, verticesLow, lengthPerAttribute * 3, lengthPerAttribute)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._levelBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, fromStorageId * levelByteStride, levels)

        gl.bindBuffer(gl.ARRAY_BUFFER, this._signalBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, this.maxCellNum * 1 + fromStorageId, deleteds)

        gl.bindBuffer(gl.ARRAY_BUFFER, null)
    }

    updateGPUCells(infos?: [fromStorageId: number, levels: Uint8Array, vertices: Float32Array, verticesLow: Float32Array, deleteds: Uint8Array]) {
        if (infos) {
            this._writeMultiCellInfoToStorageBuffer(infos)
            this._gl.flush()
        }
        this.map.triggerRepaint()
    }

    // Resize //////////////////////////////////////////////////

    private _resizeScreenFBO() {
        const gl = this._gl
        if (this._screenWidth === gl.canvas.width && this._screenHeight === gl.canvas.height) return

        if (this._boxPickingTexture !== 0) {
            gl.deleteTexture(this._boxPickingTexture)
        }
        if (this._boxPickingRBO !== 0) {
            gl.deleteRenderbuffer(this._boxPickingRBO)
        }
        if (this._boxPickingFBO !== 0) {
            gl.deleteFramebuffer(this._boxPickingFBO)
        }

        const factor = Math.min(1.0, window.devicePixelRatio)
        const width = Math.floor(gl.canvas.width / factor)
        const height = Math.floor(gl.canvas.height / factor)

        this._boxPickingTexture = gll.createTexture2D(gl, 0, width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(width * height * 4).fill(0))
        this._boxPickingRBO = gll.createRenderBuffer(gl, width, height)
        this._boxPickingFBO = gll.createFrameBuffer(gl, [this._boxPickingTexture], 0, this._boxPickingRBO)!
    }

    private _resizeHandler() {
        // Resize canvas 2d
        const canvas = this._ctx!.canvas
        if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
            canvas.width = canvas.clientWidth
            canvas.height = canvas.clientHeight
        }
    }

    private _resizeOverlayCanvas(): void {
        if (!this._overlayCanvas) return;
        const container = this.map.getContainer();
        const { width, height } = container.getBoundingClientRect();
        this._overlayCanvas.width = width;
        this._overlayCanvas.height = height;
    }

    // Show / Hide //////////////////////////////////////////////////

    show(): void {
        this.visible = true;
        if (this._overlayCanvas) {
            this._overlayCanvas.style.display = 'block';
        }
    }

    hide(): void {
        this.visible = false;
        if (this._overlayCanvas) {
            this._overlayCanvas.style.display = 'none';
        }
    }

    // Remove //////////////////////////////////////////////////

    private _removeGPUResource(gl: WebGL2RenderingContext) {
        gl.deleteProgram(this._pickingShader);
        gl.deleteProgram(this._cellMeshShader);
        gl.deleteProgram(this._cellLineShader);

        gl.deleteBuffer(this._signalBuffer);
        gl.deleteBuffer(this._tlBuffer);
        gl.deleteBuffer(this._trBuffer);
        gl.deleteBuffer(this._blBuffer);
        gl.deleteBuffer(this._brBuffer);
        gl.deleteBuffer(this._tlLowBuffer);
        gl.deleteBuffer(this._trLowBuffer);
        gl.deleteBuffer(this._blLowBuffer);
        gl.deleteBuffer(this._brLowBuffer);
        gl.deleteBuffer(this._levelBuffer);

        gl.deleteVertexArray(this._storageVAO);

        gl.deleteTexture(this._paletteTexture);
        gl.deleteTexture(this._pickingTexture);
        gl.deleteTexture(this._boxPickingTexture);

        gl.deleteFramebuffer(this._pickingFBO);
        gl.deleteFramebuffer(this._boxPickingFBO);

        gl.deleteRenderbuffer(this._pickingRBO);
        gl.deleteRenderbuffer(this._boxPickingRBO);
    }

    removeResource() {
        if (!this._patchCore) return

        this.executeClearSelection()
        this.initialized = false
        this._patchCore = null

        this.map.triggerRepaint()
    }

    remove(_: Map, gl: WebGL2RenderingContext) {
        this.removeResource();

        this._removeGPUResource(gl);

        // Remove overlay canvas
        if (this._overlayCanvas && this._overlayCanvas.parentNode) {
            this._overlayCanvas.parentNode.removeChild(this._overlayCanvas);
        }
        this._overlayCanvas = null;
        this._overlayCtx = null;

        this._patchCore?.remove()
    }

    // Draw Box //////////////////////////////////////////////////

    executeDrawBox(startPos: [number, number], endPos: [number, number]): void {
        if (!this._overlayCtx) return

        this._overlayCtx.clearRect(0, 0, this._overlayCanvas!.width, this._overlayCanvas!.height)

        const box = genPickingBox(startPos, endPos)
        drawRectangle(this._overlayCtx, box)
    }

    executeClearDrawBox(): void {
        if (!this._overlayCtx) return
        this._overlayCtx.clearRect(0, 0, this._overlayCanvas!.width, this._overlayCanvas!.height)
    }

    setCheckMode(isChecking: boolean) {
        if (isChecking) {
            CHECK_ON_EVENT()
        } else {
            CHECK_OFF_EVENT()
        }
        this.map.triggerRepaint()
    }
}

// Helpers //////////////////////////////////////////////////////////////////////////////////////////////////////

function genPickingBox(startPos: [number, number], endPos: [number, number]) {
    const _pickingBox = [
        startPos[0],
        startPos[1],
        endPos[0],
        endPos[1]
    ]
    return _pickingBox as [number, number, number, number]
}

function drawRectangle(ctx: CanvasRenderingContext2D, pickingBox: [number, number, number, number]) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

    let [startX, startY, endX, endY] = pickingBox

    if (startX > endX) { [startX, endX] = [endX, startX] }
    if (startY > endY) { [startY, endY] = [endY, startY] }

    const width = (endX - startX)
    const height = (endY - startY)

    ctx.strokeStyle = 'rgba(227, 102, 0, 0.67)'
    ctx.fillStyle = 'rgba(235, 190, 148, 0.52)'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 3])
    ctx.strokeRect(startX, startY, width, height)
    ctx.fillRect(startX, startY, width, height)
}
