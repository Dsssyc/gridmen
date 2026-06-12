export type VectorDraftGeometryType = 'line' | 'polygon'
export type VectorDraftCoordinate = [number, number]

export interface VectorDraftOperation {
    coordinate: VectorDraftCoordinate
    index: number
}

export interface VectorDraftSnapshot {
    type: VectorDraftGeometryType
    featureId: string
    coordinates: VectorDraftCoordinate[]
    currentVertexPosition: number
    undoStack: VectorDraftOperation[]
    redoStack: VectorDraftOperation[]
}

export interface VectorDraftUndoManagerOptions {
    type: VectorDraftGeometryType
    featureId: string
    coordinates?: VectorDraftCoordinate[]
    undoStack?: VectorDraftOperation[]
    redoStack?: VectorDraftOperation[]
}

const cloneCoordinate = (coordinate: VectorDraftCoordinate): VectorDraftCoordinate => [
    coordinate[0],
    coordinate[1],
]

const cloneCoordinates = (coordinates: VectorDraftCoordinate[] = []): VectorDraftCoordinate[] =>
    coordinates.map(cloneCoordinate)

const cloneOperations = (operations: VectorDraftOperation[] = []): VectorDraftOperation[] =>
    operations.map((operation) => ({
        index: operation.index,
        coordinate: cloneCoordinate(operation.coordinate),
    }))

export class VectorDraftUndoManager {
    readonly type: VectorDraftGeometryType
    readonly featureId: string

    private coordinates: VectorDraftCoordinate[]
    private undoStack: VectorDraftOperation[]
    private redoStack: VectorDraftOperation[]

    constructor(options: VectorDraftUndoManagerOptions) {
        this.type = options.type
        this.featureId = options.featureId
        this.coordinates = cloneCoordinates(options.coordinates)
        this.undoStack = cloneOperations(options.undoStack)
        this.redoStack = cloneOperations(options.redoStack)
    }

    static fromSnapshot(snapshot: VectorDraftSnapshot): VectorDraftUndoManager {
        return new VectorDraftUndoManager(snapshot)
    }

    addVertex(coordinate: VectorDraftCoordinate): void {
        const operation: VectorDraftOperation = {
            index: this.coordinates.length,
            coordinate: cloneCoordinate(coordinate),
        }
        this.coordinates.push(cloneCoordinate(coordinate))
        this.undoStack.push(operation)
        this.redoStack = []
    }

    undo(): VectorDraftCoordinate[] {
        const operation = this.undoStack.pop()
        if (!operation) return this.getCoordinates()

        this.coordinates.splice(operation.index, 1)
        this.redoStack.push(operation)
        return this.getCoordinates()
    }

    redo(): VectorDraftCoordinate[] {
        const operation = this.redoStack.pop()
        if (!operation) return this.getCoordinates()

        this.coordinates.splice(operation.index, 0, cloneCoordinate(operation.coordinate))
        this.undoStack.push(operation)
        return this.getCoordinates()
    }

    canUndo(): boolean {
        return this.undoStack.length > 0
    }

    canRedo(): boolean {
        return this.redoStack.length > 0
    }

    canFinalize(): boolean {
        return this.type === 'line'
            ? this.coordinates.length >= 2
            : this.coordinates.length >= 3
    }

    hasCoordinates(): boolean {
        return this.coordinates.length > 0
    }

    getCoordinates(): VectorDraftCoordinate[] {
        return cloneCoordinates(this.coordinates)
    }

    getCurrentVertexPosition(): number {
        return this.coordinates.length
    }

    toSnapshot(): VectorDraftSnapshot {
        return {
            type: this.type,
            featureId: this.featureId,
            coordinates: this.getCoordinates(),
            currentVertexPosition: this.getCurrentVertexPosition(),
            undoStack: cloneOperations(this.undoStack),
            redoStack: cloneOperations(this.redoStack),
        }
    }
}
