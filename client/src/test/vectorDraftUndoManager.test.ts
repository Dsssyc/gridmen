import assert from 'node:assert/strict'
import test from 'node:test'

import { VectorDraftUndoManager } from '../src/template/vector/vectorDraftUndoManager'

test('tracks vector draft vertex undo redo and restores from snapshot', () => {
    const manager = new VectorDraftUndoManager({
        type: 'line',
        featureId: 'draft-1',
        coordinates: [],
    })

    manager.addVertex([1, 1])
    manager.addVertex([2, 2])

    assert.deepEqual(manager.getCoordinates(), [[1, 1], [2, 2]])
    assert.equal(manager.canUndo(), true)
    assert.equal(manager.canRedo(), false)

    manager.undo()
    assert.deepEqual(manager.getCoordinates(), [[1, 1]])
    assert.equal(manager.canRedo(), true)

    manager.redo()
    assert.deepEqual(manager.getCoordinates(), [[1, 1], [2, 2]])

    manager.undo()
    manager.addVertex([3, 3])
    assert.deepEqual(manager.getCoordinates(), [[1, 1], [3, 3]])
    assert.equal(manager.canRedo(), false)

    const snapshot = manager.toSnapshot()
    assert.equal(snapshot.currentVertexPosition, 2)

    const restored = VectorDraftUndoManager.fromSnapshot(snapshot)
    assert.deepEqual(restored.getCoordinates(), [[1, 1], [3, 3]])
    assert.equal(restored.canUndo(), true)

    restored.undo()
    assert.deepEqual(restored.getCoordinates(), [[1, 1]])
})

test('requires enough vertices before finalizing a draft geometry', () => {
    const line = new VectorDraftUndoManager({
        type: 'line',
        featureId: 'line-draft',
        coordinates: [],
    })
    assert.equal(line.canFinalize(), false)
    line.addVertex([0, 0])
    assert.equal(line.canFinalize(), false)
    line.addVertex([1, 1])
    assert.equal(line.canFinalize(), true)

    const polygon = new VectorDraftUndoManager({
        type: 'polygon',
        featureId: 'polygon-draft',
        coordinates: [],
    })
    polygon.addVertex([0, 0])
    polygon.addVertex([1, 0])
    assert.equal(polygon.canFinalize(), false)
    polygon.addVertex([1, 1])
    assert.equal(polygon.canFinalize(), true)
})
