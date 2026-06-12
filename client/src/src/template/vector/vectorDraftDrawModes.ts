import {
    VectorDraftUndoManager,
    type VectorDraftCoordinate,
    type VectorDraftGeometryType,
    type VectorDraftSnapshot,
} from './vectorDraftUndoManager'

export const VECTOR_DRAFT_LINE_MODE = 'vector_draw_line_string'
export const VECTOR_DRAFT_POLYGON_MODE = 'vector_draw_polygon'

export interface VectorDraftModeHandle {
    type: VectorDraftGeometryType
    featureId: string
    undo: () => void
    redo: () => void
    pause: () => void
    finalize: () => void
    cancel: () => void
    canUndo: () => boolean
    canRedo: () => boolean
    canFinalize: () => boolean
    snapshot: () => VectorDraftSnapshot
    setColor: (color: string) => void
}

export interface VectorDraftModeController {
    current: VectorDraftModeHandle | null
}

export interface VectorDraftModeOptions {
    snapshot?: VectorDraftSnapshot | null
    controller?: VectorDraftModeController
    color?: string
    onDraftChange?: (snapshot: VectorDraftSnapshot | null, status: 'active' | 'paused' | 'finalized' | 'cancelled') => void
}

interface DraftLngLat {
    lng: number
    lat: number
}

interface DraftMapEvent {
    lngLat: DraftLngLat
    featureTarget?: {
        properties?: {
            meta?: string
        }
    }
}

type DraftKeyboardEvent = KeyboardEvent

interface DraftDoubleClickZoomControl {
    disable: () => void
    enable: () => void
}

interface DrawFeature {
    id: string
    setCoordinates: (coordinates: VectorDraftCoordinate[] | VectorDraftCoordinate[][]) => void
    setProperty: (key: string, value: string) => void
    toGeoJSON: () => GeoJSON.Feature
}

interface DraftFeatureInput {
    id?: string
    type: 'Feature'
    properties: Record<string, unknown>
    geometry: {
        type: 'LineString' | 'Polygon'
        coordinates: VectorDraftCoordinate[] | VectorDraftCoordinate[][]
    }
}

type DraftDisplayFeature = GeoJSON.Feature<GeoJSON.LineString | GeoJSON.Polygon> & {
    properties: Record<string, unknown> & {
        id?: string
        active?: string
        meta?: string
    }
}

interface DrawModeContext {
    map?: {
        doubleClickZoom?: DraftDoubleClickZoomControl
    }
    _ctx?: {
        store?: {
            getInitialConfigValue?: (key: string) => unknown
        }
    }
    newFeature: (feature: DraftFeatureInput) => DrawFeature
    addFeature: (feature: DrawFeature) => void
    clearSelectedFeatures: () => void
    updateUIClasses: (options: { mouse: string }) => void
    activateUIButton: (name?: string) => void
    setActionableState: (actions: { trash?: boolean }) => void
    changeMode: (mode: string, options?: Record<string, unknown>, eventOptions?: { silent?: boolean }) => void
    deleteFeature: (featureIds: string[], options?: { silent?: boolean }) => void
    getFeature: (featureId: string) => DrawFeature | undefined
    fire: (eventName: string, eventData: { features: GeoJSON.Feature[] }) => void
}

interface VectorDraftModeState {
    type: VectorDraftGeometryType
    feature: DrawFeature
    manager: VectorDraftUndoManager
    controller?: VectorDraftModeController
    cursorCoordinate: VectorDraftCoordinate | null
    stopAction: 'finalize' | 'pause' | 'cancel'
    onDraftChange?: VectorDraftModeOptions['onDraftChange']
}

const geojsonTypes = {
    FEATURE: 'Feature',
    LINE_STRING: 'LineString',
    POLYGON: 'Polygon',
    POINT: 'Point',
} as const

const cursors = {
    ADD: 'add',
    POINTER: 'pointer',
    NONE: 'none',
} as const

const drawTypes = {
    LINE: 'line_string',
    POLYGON: 'polygon',
} as const

const events = {
    CREATE: 'draw.create',
} as const

const meta = {
    FEATURE: 'feature',
    VERTEX: 'vertex',
} as const

const activeStates = {
    ACTIVE: 'true',
    INACTIVE: 'false',
} as const

const cloneCoordinate = (coordinate: VectorDraftCoordinate): VectorDraftCoordinate => [
    coordinate[0],
    coordinate[1],
]

const getEventCoordinate = (event: DraftMapEvent): VectorDraftCoordinate => [
    event.lngLat.lng,
    event.lngLat.lat,
]

const isVertexEvent = (event: DraftMapEvent): boolean =>
    event.featureTarget?.properties?.meta === meta.VERTEX

const isEnterKey = (event: DraftKeyboardEvent): boolean => event.key === 'Enter' || event.keyCode === 13

const isEscapeKey = (event: DraftKeyboardEvent): boolean => event.key === 'Escape' || event.keyCode === 27

const isEventAtCoordinate = (event: DraftMapEvent, coordinate: VectorDraftCoordinate | undefined): boolean => {
    if (!event.lngLat || !coordinate) return false
    return event.lngLat.lng === coordinate[0] && event.lngLat.lat === coordinate[1]
}

const createVertex = (parentId: string, coordinates: VectorDraftCoordinate, path: string): GeoJSON.Feature => ({
    type: geojsonTypes.FEATURE,
    properties: {
        meta: meta.VERTEX,
        parent: parentId,
        coord_path: path,
        active: activeStates.INACTIVE,
    },
    geometry: {
        type: geojsonTypes.POINT,
        coordinates,
    },
})

const disableDoubleClickZoom = (ctx: DrawModeContext) => {
    setTimeout(() => ctx.map?.doubleClickZoom?.disable?.(), 0)
}

const enableDoubleClickZoom = (ctx: DrawModeContext) => {
    setTimeout(() => {
        const enabledInitially = ctx._ctx?.store?.getInitialConfigValue?.('doubleClickZoom')
        if (enabledInitially !== false) ctx.map?.doubleClickZoom?.enable?.()
    }, 0)
}

const getActiveCoordinates = (manager: VectorDraftUndoManager, cursorCoordinate: VectorDraftCoordinate | null) => {
    const coordinates = manager.getCoordinates()
    if (cursorCoordinate) return [...coordinates, cloneCoordinate(cursorCoordinate)]
    const lastCoordinate = coordinates[coordinates.length - 1]
    return lastCoordinate ? [...coordinates, cloneCoordinate(lastCoordinate)] : coordinates
}

const applyFeatureCoordinates = (state: VectorDraftModeState) => {
    const activeCoordinates = getActiveCoordinates(state.manager, state.cursorCoordinate)
    if (state.type === 'line') {
        state.feature.setCoordinates(activeCoordinates)
    } else {
        state.feature.setCoordinates([activeCoordinates])
    }
}

const notifyActiveDraft = (state: VectorDraftModeState) => {
    state.onDraftChange?.(state.manager.toSnapshot(), 'active')
}

const installController = (ctx: DrawModeContext, state: VectorDraftModeState) => {
    const controller = state.controller
    if (!controller) return

    controller.current = {
        type: state.type,
        featureId: state.feature.id,
        undo: () => {
            state.manager.undo()
            applyFeatureCoordinates(state)
            notifyActiveDraft(state)
        },
        redo: () => {
            state.manager.redo()
            applyFeatureCoordinates(state)
            notifyActiveDraft(state)
        },
        pause: () => {
            state.stopAction = 'pause'
            ctx.changeMode('simple_select', {}, { silent: true })
        },
        finalize: () => {
            state.stopAction = 'finalize'
            ctx.changeMode('simple_select', { featureIds: [state.feature.id] })
        },
        cancel: () => {
            state.stopAction = 'cancel'
            ctx.deleteFeature([state.feature.id], { silent: true })
            ctx.changeMode('simple_select')
        },
        canUndo: () => state.manager.canUndo(),
        canRedo: () => state.manager.canRedo(),
        canFinalize: () => state.manager.canFinalize(),
        snapshot: () => state.manager.toSnapshot(),
        setColor: (color: string) => {
            state.feature.setProperty('color', color)
            applyFeatureCoordinates(state)
        },
    }
}

const clearController = (state: VectorDraftModeState) => {
    const controller = state.controller
    if (!controller) return
    if (controller.current?.featureId === state.feature.id) {
        controller.current = null
    }
}

const createLineFeature = (ctx: DrawModeContext, snapshot?: VectorDraftSnapshot | null): DrawFeature => {
    const coordinates = snapshot?.coordinates ?? []
    return ctx.newFeature({
        id: snapshot?.featureId,
        type: geojsonTypes.FEATURE,
        properties: {},
        geometry: {
            type: geojsonTypes.LINE_STRING,
            coordinates,
        },
    })
}

const createPolygonFeature = (ctx: DrawModeContext, snapshot?: VectorDraftSnapshot | null): DrawFeature => {
    const coordinates = snapshot?.coordinates ?? []
    const ring = coordinates.length > 0 ? [...coordinates, coordinates[0]] : []
    return ctx.newFeature({
        id: snapshot?.featureId,
        type: geojsonTypes.FEATURE,
        properties: {},
        geometry: {
            type: geojsonTypes.POLYGON,
            coordinates: [ring],
        },
    })
}

const setupDraftMode = (
    ctx: DrawModeContext,
    type: VectorDraftGeometryType,
    options: VectorDraftModeOptions = {},
): VectorDraftModeState => {
    const feature = type === 'line'
        ? createLineFeature(ctx, options.snapshot)
        : createPolygonFeature(ctx, options.snapshot)

    ctx.addFeature(feature)
    if (options.color) feature.setProperty('color', options.color)

    const manager = options.snapshot
        ? VectorDraftUndoManager.fromSnapshot(options.snapshot)
        : new VectorDraftUndoManager({
            type,
            featureId: feature.id,
            coordinates: [],
        })

    const managerCoordinates = manager.getCoordinates()
    const lastCoordinate = managerCoordinates[managerCoordinates.length - 1] ?? null
    const state: VectorDraftModeState = {
        type,
        feature,
        manager,
        controller: options.controller,
        cursorCoordinate: lastCoordinate,
        stopAction: 'finalize',
        onDraftChange: options.onDraftChange,
    }

    ctx.clearSelectedFeatures()
    disableDoubleClickZoom(ctx)
    ctx.updateUIClasses({ mouse: cursors.ADD })
    ctx.activateUIButton(type === 'line' ? drawTypes.LINE : drawTypes.POLYGON)
    ctx.setActionableState({ trash: true })

    applyFeatureCoordinates(state)
    installController(ctx, state)
    notifyActiveDraft(state)

    return state
}

const addVertex = (state: VectorDraftModeState, coordinate: VectorDraftCoordinate) => {
    state.manager.addVertex(coordinate)
    state.cursorCoordinate = coordinate
    applyFeatureCoordinates(state)
    notifyActiveDraft(state)
}

const finishIfValid = (ctx: DrawModeContext, state: VectorDraftModeState) => {
    if (!state.manager.canFinalize()) return
    state.stopAction = 'finalize'
    ctx.changeMode('simple_select', { featureIds: [state.feature.id] })
}

const handleClick = (ctx: DrawModeContext, state: VectorDraftModeState, event: DraftMapEvent) => {
    if (isVertexEvent(event)) {
        finishIfValid(ctx, state)
        return
    }

    const coordinates = state.manager.getCoordinates()
    const lastCoordinate = coordinates[coordinates.length - 1]
    if (coordinates.length > 0 && isEventAtCoordinate(event, lastCoordinate)) {
        finishIfValid(ctx, state)
        return
    }

    ctx.updateUIClasses({ mouse: cursors.ADD })
    addVertex(state, getEventCoordinate(event))
}

const finalizeFeature = (ctx: DrawModeContext, state: VectorDraftModeState) => {
    const coordinates = state.manager.getCoordinates()

    if (!state.manager.canFinalize()) {
        ctx.deleteFeature([state.feature.id], { silent: true })
        state.onDraftChange?.(null, 'cancelled')
        return
    }

    if (state.type === 'line') {
        state.feature.setCoordinates(coordinates)
    } else {
        state.feature.setCoordinates([coordinates])
    }

    ctx.fire(events.CREATE, {
        features: [state.feature.toGeoJSON()],
    })
    state.onDraftChange?.(null, 'finalized')
}

const stopDraftMode = (ctx: DrawModeContext, state: VectorDraftModeState) => {
    ctx.updateUIClasses({ mouse: cursors.NONE })
    enableDoubleClickZoom(ctx)
    ctx.activateUIButton()

    if (ctx.getFeature(state.feature.id) === undefined) {
        clearController(state)
        state.onDraftChange?.(null, 'cancelled')
        return
    }

    if (state.stopAction === 'pause') {
        state.onDraftChange?.(state.manager.toSnapshot(), 'paused')
        ctx.deleteFeature([state.feature.id], { silent: true })
        clearController(state)
        return
    }

    if (state.stopAction === 'cancel') {
        ctx.deleteFeature([state.feature.id], { silent: true })
        state.onDraftChange?.(null, 'cancelled')
        clearController(state)
        return
    }

    finalizeFeature(ctx, state)
    clearController(state)
}

const buildDraftMode = (type: VectorDraftGeometryType) => ({
    onSetup(this: DrawModeContext, options: VectorDraftModeOptions = {}) {
        return setupDraftMode(this, type, options)
    },
    onClick(this: DrawModeContext, state: VectorDraftModeState, event: DraftMapEvent) {
        handleClick(this, state, event)
    },
    onTap(this: DrawModeContext, state: VectorDraftModeState, event: DraftMapEvent) {
        handleClick(this, state, event)
    },
    onMouseMove(this: DrawModeContext, state: VectorDraftModeState, event: DraftMapEvent) {
        state.cursorCoordinate = getEventCoordinate(event)
        applyFeatureCoordinates(state)
        this.updateUIClasses({ mouse: isVertexEvent(event) ? cursors.POINTER : cursors.ADD })
    },
    onKeyUp(this: DrawModeContext, state: VectorDraftModeState, event: DraftKeyboardEvent) {
        if (isEscapeKey(event)) {
            state.stopAction = 'cancel'
            this.deleteFeature([state.feature.id], { silent: true })
            this.changeMode('simple_select')
        } else if (isEnterKey(event)) {
            finishIfValid(this, state)
        }
    },
    onTrash(this: DrawModeContext, state: VectorDraftModeState) {
        state.stopAction = 'cancel'
        this.deleteFeature([state.feature.id], { silent: true })
        this.changeMode('simple_select')
    },
    onStop(this: DrawModeContext, state: VectorDraftModeState) {
        stopDraftMode(this, state)
    },
    toDisplayFeatures(state: VectorDraftModeState, geojson: DraftDisplayFeature, display: (feature: GeoJSON.Feature) => void) {
        const isActive = geojson.properties.id === state.feature.id
        geojson.properties.active = isActive ? activeStates.ACTIVE : activeStates.INACTIVE
        if (!isActive) {
            display(geojson)
            return
        }

        geojson.properties.meta = meta.FEATURE
        const coordinates = state.manager.getCoordinates()

        if (state.type === 'line') {
            const line = geojson.geometry as GeoJSON.LineString
            if (line.coordinates.length < 2) return
            const lastIndex = coordinates.length - 1
            if (lastIndex >= 0) {
                display(createVertex(state.feature.id, coordinates[lastIndex], `${lastIndex}`))
            }
            display(geojson)
            return
        }

        const polygon = geojson.geometry as GeoJSON.Polygon
        if (polygon.coordinates.length === 0) return
        const ring = polygon.coordinates[0]
        if (!ring || ring.length < 3) return

        if (coordinates[0]) {
            display(createVertex(state.feature.id, coordinates[0], '0.0'))
        }
        if (coordinates.length > 2) {
            const lastIndex = coordinates.length - 1
            display(createVertex(state.feature.id, coordinates[lastIndex], `0.${lastIndex}`))
        }

        if (ring.length <= 4) {
            if (ring.length === 3) return
            display({
                type: geojsonTypes.FEATURE,
                properties: geojson.properties,
                geometry: {
                    type: geojsonTypes.LINE_STRING,
                    coordinates: ring.slice(0, 2),
                },
            })
            return
        }

        display(geojson)
    },
})

export const VectorDraftLineMode = buildDraftMode('line')
export const VectorDraftPolygonMode = buildDraftMode('polygon')
