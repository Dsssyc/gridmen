# Unified Layer Z-Order — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Layer panel order the single source of truth for map z-order, supporting full cross-type reorder (vectors, patches, future DEM, …).

**Architecture:** Each Layer-panel item owns its own dedicated set of mapbox layers. A central `LayerOrderCoordinator` subscribes to `useLayerStore` and translates panel order → `map.moveLayer(id)` calls so the global mapbox layer stack matches the panel exactly. Vectors are displayed via per-vector mapbox source/layers; patches are wrapped in a per-patch CLG instance (no shared CLG singleton). MapboxDraw stays as a globally-available editing tool, used only when actively editing a vector or drawing a rectangle.

**Tech Stack:** React 19, mapbox-gl-js, mapbox-gl-draw, Zustand, TypeScript, Vite. No JS test framework in use — verification is **manual smoke testing** at each task.

---

## File Structure

| File | Role |
|---|---|
| `client/src/src/views/mapView/layerOrderCoordinator.ts` | **NEW** — Single coordinator that maps panel order → mapbox `moveLayer` calls |
| `client/src/src/views/mapView/vectorDisplayLayer.ts` | **NEW** — Per-vector mapbox source + fill/line/circle paint layers |
| `client/src/src/views/mapView/topology/customLayerGroup.ts` | Keep class; drop the singleton assumption |
| `client/src/src/views/mapView/topology/topologyLayerManager.ts` | Each call creates a per-patch CLG and `map.addLayer`s it |
| `client/src/src/views/mapView/mapViewComponent.tsx` | Stop creating the global CLG; init coordinator |
| `client/src/src/template/vector/vectorCheck.tsx` | Display via `vectorDisplayLayer`; register w/ coordinator |
| `client/src/src/template/vector/vectorEdit.tsx` | Display via `vectorDisplayLayer`; toggle visibility around MapboxDraw edit; write back on save |
| `client/src/src/template/vector/vectorCreation.tsx` | Display via `vectorDisplayLayer`; same MapboxDraw handoff pattern |
| `client/src/src/template/patch/patchCheck.tsx` | Use per-patch CLG; register w/ coordinator |
| `client/src/src/template/patch/patchEdit.tsx` | Same |
| `client/src/src/template/patch/patchCreation.tsx` | Same |
| `client/src/src/utils/utils.ts` | Keep `waitForCustomLayerGroup` helper unused (or remove later); no behavior change required |

---

## Conventions used in this plan

- "Panel top = map top" (matches QGIS/ArcGIS).
- Per-vector ids: source `vec-src-{nodeKey}`, layers `vec-fill-{nodeKey}` / `vec-line-{nodeKey}` / `vec-circle-{nodeKey}`.
- Per-patch CLG mapbox layer id: `patch-clg-{nodeKey}`. The `TopologyLayer` inside it keeps id `TopologyLayer:{nodeKey}` (preserves existing behavior).
- Each task ends with a manual smoke test and a commit.
- Run `cd client/src && npm run build` after structural changes to catch TS/ESLint errors.

---

## Tasks

<!-- Task content inserted via edits -->

### Task 1: Create LayerOrderCoordinator module

**Files:**
- Create: `client/src/src/views/mapView/layerOrderCoordinator.ts`

- [ ] **Step 1: Create the coordinator module**

```ts
// client/src/src/views/mapView/layerOrderCoordinator.ts
import mapboxgl from 'mapbox-gl'
import { useLayerStore } from '@/store/storeSet'
import type { Layer } from '@/store/storeTypes'

class LayerOrderCoordinator {
    private map: mapboxgl.Map | null = null
    private ownership = new Map<string, string[]>() // panelLayerId -> mapbox layer ids
    private unsubscribe: (() => void) | null = null
    private pendingApply = false

    setMap(map: mapboxgl.Map) {
        this.map = map
        if (this.unsubscribe) this.unsubscribe()
        this.unsubscribe = useLayerStore.subscribe(() => this.apply())
        this.apply()
    }

    register(panelLayerId: string, mapboxLayerIds: string[]) {
        this.ownership.set(panelLayerId, mapboxLayerIds)
        this.apply()
    }

    unregister(panelLayerId: string) {
        this.ownership.delete(panelLayerId)
        this.apply()
    }

    apply() {
        const map = this.map
        if (!map) return
        if (!map.isStyleLoaded()) {
            if (this.pendingApply) return
            this.pendingApply = true
            map.once('idle', () => {
                this.pendingApply = false
                this.apply()
            })
            return
        }

        const order = this.flattenPanel(useLayerStore.getState().layers)
        // panel: top-first. Walk panel from BOTTOM to TOP. For each owner, call
        // map.moveLayer(id) (no beforeId) which moves the layer to the very top
        // of the mapbox layer stack. After the loop, panel-top will be at the
        // top of the mapbox stack — exactly the desired result.
        for (let i = order.length - 1; i >= 0; i--) {
            const ids = this.ownership.get(order[i])
            if (!ids) continue
            for (const id of ids) {
                if (map.getLayer(id)) {
                    try {
                        map.moveLayer(id)
                    } catch (e) {
                        console.warn('[layerOrderCoordinator] moveLayer failed', id, e)
                    }
                }
            }
        }
    }

    private flattenPanel(layers: Layer[]): string[] {
        const out: string[] = []
        const walk = (arr: Layer[]) => {
            for (const l of arr) {
                if (l.type === 'group') {
                    if (l.children) walk(l.children)
                } else {
                    out.push(l.id)
                }
            }
        }
        walk(layers)
        return out
    }
}

export const layerOrderCoordinator = new LayerOrderCoordinator()
```

- [ ] **Step 2: Run build to catch TS errors**

```bash
cd client/src && npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/src/views/mapView/layerOrderCoordinator.ts
git commit -m "feat(mapView): add LayerOrderCoordinator skeleton

Single source of truth that maps panel order to mapbox moveLayer calls.
Subscribes to useLayerStore; applied on register/unregister/store changes.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Wire coordinator into MapContainer

**Files:**
- Modify: `client/src/src/views/mapView/mapViewComponent.tsx` (around lines 17 and 143-148)

- [ ] **Step 1: Import the coordinator**

Add at top of `mapViewComponent.tsx` (near other imports):

```ts
import { layerOrderCoordinator } from './layerOrderCoordinator'
```

- [ ] **Step 2: Call setMap in mapInstance.on('load')**

Replace the existing `mapInstance.on('load', ...)` block:

```ts
mapInstance.on('load', async () => {
    const layerGroup = new CustomLayerGroup()
    layerGroup.id = 'gridman-custom-layer-group'
    mapInstance.addLayer(layerGroup)
    store.set('clg', layerGroup)
    layerOrderCoordinator.setMap(mapInstance)
})
```

(The global CLG is removed in a later task — keeping it for now so existing patch flows don't break.)

- [ ] **Step 3: Build & smoke**

```bash
cd client/src && npm run build
```

Then `npm start` from repo root, open the app, open one vector, browser devtools console — confirm there are no errors mentioning `layerOrderCoordinator`. The map should render normally.

- [ ] **Step 4: Commit**

```bash
git add client/src/src/views/mapView/mapViewComponent.tsx
git commit -m "feat(mapView): bind LayerOrderCoordinator to map on load

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Create vectorDisplayLayer module

**Files:**
- Create: `client/src/src/views/mapView/vectorDisplayLayer.ts`

- [ ] **Step 1: Create the module**

```ts
// client/src/src/views/mapView/vectorDisplayLayer.ts
import mapboxgl from 'mapbox-gl'

const sourceId = (nodeKey: string) => `vec-src-${nodeKey}`
const fillId = (nodeKey: string) => `vec-fill-${nodeKey}`
const lineId = (nodeKey: string) => `vec-line-${nodeKey}`
const circleId = (nodeKey: string) => `vec-circle-${nodeKey}`

const colorExpr: any = ['coalesce', ['get', 'color'], '#F06B00']

export interface VectorDisplayHandle {
    nodeKey: string
    sourceId: string
    mapboxLayerIds: string[]
    setData(featureCollection: GeoJSON.FeatureCollection): void
    setVisible(visible: boolean): void
    remove(): void
}

/**
 * Tag every feature in `fc` with a `color` property = `hexColor` (used by paint expressions).
 * Mutates the feature collection in place.
 */
export function tagVectorColor(fc: GeoJSON.FeatureCollection, hexColor: string): void {
    if (!fc?.features) return
    for (const f of fc.features) {
        f.properties = { ...(f.properties ?? {}), color: hexColor }
    }
}

export function addVectorDisplay(
    map: mapboxgl.Map,
    nodeKey: string,
    featureCollection: GeoJSON.FeatureCollection,
): VectorDisplayHandle {
    const sId = sourceId(nodeKey)
    const fId = fillId(nodeKey)
    const lId = lineId(nodeKey)
    const cId = circleId(nodeKey)

    if (map.getSource(sId)) {
        ;(map.getSource(sId) as mapboxgl.GeoJSONSource).setData(featureCollection)
    } else {
        map.addSource(sId, { type: 'geojson', data: featureCollection })
    }

    if (!map.getLayer(fId)) {
        map.addLayer({
            id: fId,
            type: 'fill',
            source: sId,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'fill-color': colorExpr, 'fill-opacity': 0.1 },
        } as any)
    }
    if (!map.getLayer(lId)) {
        map.addLayer({
            id: lId,
            type: 'line',
            source: sId,
            filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': colorExpr, 'line-width': 2, 'line-dasharray': [2, 2] },
        } as any)
    }
    if (!map.getLayer(cId)) {
        map.addLayer({
            id: cId,
            type: 'circle',
            source: sId,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: { 'circle-radius': 5, 'circle-color': colorExpr },
        } as any)
    }

    const layerIds = [fId, lId, cId]

    return {
        nodeKey,
        sourceId: sId,
        mapboxLayerIds: layerIds,
        setData(fc) {
            const src = map.getSource(sId) as mapboxgl.GeoJSONSource | undefined
            if (src) src.setData(fc)
        },
        setVisible(visible) {
            const v = visible ? 'visible' : 'none'
            for (const id of layerIds) {
                if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v)
            }
        },
        remove() {
            for (const id of layerIds) {
                if (map.getLayer(id)) map.removeLayer(id)
            }
            if (map.getSource(sId)) map.removeSource(sId)
        },
    }
}
```

- [ ] **Step 2: Build to verify types**

```bash
cd client/src && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add client/src/src/views/mapView/vectorDisplayLayer.ts
git commit -m "feat(mapView): add per-vector mapbox display-layer helper

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Switch vectorCheck to vectorDisplayLayer + register with coordinator

**Files:**
- Modify: `client/src/src/template/vector/vectorCheck.tsx` (loadContext at lines 76-116, unloadContext at lines 118-134)

- [ ] **Step 1: Add imports**

Add near the existing imports (around line 11):

```ts
import { addVectorDisplay, tagVectorColor, VectorDisplayHandle } from '@/views/mapView/vectorDisplayLayer'
import { layerOrderCoordinator } from '@/views/mapView/layerOrderCoordinator'
```

- [ ] **Step 2: Extend PageContext to hold display handle**

Replace the `PageContext` interface (lines 22-31):

```ts
interface PageContext {
    drawVector: GeoJSON.FeatureCollection | null
    vectorData: {
        type: string
        name: string
        epsg: string
        color: string
    }
    checkedVectorIds: Set<string>
    displayHandle: VectorDisplayHandle | null
}
```

And update the `useRef<PageContext>` initial value (around line 56) to include `displayHandle: null`.

- [ ] **Step 3: Replace MapboxDraw display in `loadContext`**

In `loadContext` (around lines 95-101), replace:

```ts
const addedIds = drawInstance.add(pageContext.current.drawVector!) as string[]
addedIds.forEach((id) => pageContext.current.checkedVectorIds.add(id))

const hex = getHexColorByValue(pageContext.current.vectorData.color)
for (const fid of pageContext.current.checkedVectorIds) {
    drawInstance.setFeatureProperty(fid, "color", hex)
};
```

with:

```ts
const hex = getHexColorByValue(pageContext.current.vectorData.color)
tagVectorColor(pageContext.current.drawVector!, hex)
const handle = addVectorDisplay(map, node.nodeInfo, pageContext.current.drawVector!)
pageContext.current.displayHandle = handle
layerOrderCoordinator.register(node.nodeInfo, handle.mapboxLayerIds)
```

- [ ] **Step 4: Update `__cleanup.vectorCheck` to use the display handle**

Inside the `__cleanup.vectorCheck` callback assigned in `loadContext` (lines 107-111), replace the body with:

```ts
vectorCheck: () => {
    pageContext.current.displayHandle?.remove()
    pageContext.current.displayHandle = null
    pageContext.current.checkedVectorIds.clear()
    layerOrderCoordinator.unregister(node.nodeInfo)
}
```

Apply the **same** replacement to the `vectorCheck` cleanup defined in `unloadContext` (lines 127-131).

- [ ] **Step 5: Build**

```bash
cd client/src && npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Manual smoke**

Run `npm start`, open one polygon vector node in Check view. Confirm:
1. Geometry renders on map with the configured color (dashed line, light fill).
2. Closing the node removes the geometry from the map.
3. Open vector A, then open vector B. Layer panel should show `[B, A]`. On the map, B's geometries should render above A's (panel-top = map-top).
4. Pan the map several times — the cross-vector z-order does NOT flip.

- [ ] **Step 7: Commit**

```bash
git add client/src/src/template/vector/vectorCheck.tsx
git commit -m "feat(vectorCheck): display via per-vector mapbox layers

Replaces shared MapboxDraw display path with dedicated source/layers per
vector node, registered with LayerOrderCoordinator so panel order drives
map z-order.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: vectorEdit — own display layer, hide during edit, write back on save

**Background:** While `vectorEdit` is mounted, the vector is live in MapboxDraw for interactive editing. To keep panel-z-order correct AND avoid double-rendering, this task adds a per-vector display layer that is **created on mount, hidden while edit is active, and re-shown with updated data on save / cleanup**.

**Files:**
- Modify: `client/src/src/template/vector/vectorEdit.tsx`

- [ ] **Step 1: Add imports**

```ts
import { addVectorDisplay, tagVectorColor, VectorDisplayHandle } from '@/views/mapView/vectorDisplayLayer'
import { layerOrderCoordinator } from '@/views/mapView/layerOrderCoordinator'
```

- [ ] **Step 2: Extend PageContext with displayHandle**

Add `displayHandle: VectorDisplayHandle | null` to the `PageContext` interface and to the `useRef<PageContext>` initial value.

- [ ] **Step 3: Create + hide display in `loadContext`**

In `loadContext`, after `pageContext.current.drawVector = ...` and BEFORE `drawInstance.add(...)`, insert:

```ts
const hex = getHexColorByValue(pageContext.current.vectorData.color)
const fcCopy: GeoJSON.FeatureCollection = JSON.parse(JSON.stringify(pageContext.current.drawVector!))
tagVectorColor(fcCopy, hex)
const handle = addVectorDisplay(map, node.nodeInfo, fcCopy)
handle.setVisible(false)  // hidden while MapboxDraw is editing
pageContext.current.displayHandle = handle
layerOrderCoordinator.register(node.nodeInfo, handle.mapboxLayerIds)
```

- [ ] **Step 4: Write back to display + unregister on cleanup**

Replace BOTH `__cleanup.vectorEdit` callbacks (one in `loadContext` and one in `unloadContext`) with:

```ts
vectorEdit: () => {
    const featureIds = Array.from(pageContext.current.editedVectorIds)
    const handle = pageContext.current.displayHandle
    if (handle) {
        const fc = getNodeFeatures()
        const hex = getHexColorByValue(pageContext.current.vectorData.color)
        tagVectorColor(fc, hex)
        handle.setData(fc)
        handle.setVisible(true)
        handle.remove()
        pageContext.current.displayHandle = null
    }
    drawInstance.delete(featureIds)
    pageContext.current.editedVectorIds.clear()
    layerOrderCoordinator.unregister(node.nodeInfo)
    ;(node as ResourceNode).mountParams = undefined
}
```

- [ ] **Step 5: On explicit save (file write success), refresh display data**

In the existing save handler, after a successful save:

```ts
const fc = getNodeFeatures()
const hex = getHexColorByValue(pageContext.current.vectorData.color)
tagVectorColor(fc, hex)
pageContext.current.displayHandle?.setData(fc)
```

- [ ] **Step 6: Build**

```bash
cd client/src && npm run build
```

- [ ] **Step 7: Manual smoke**

1. Open vector A in Edit view → editable via MapboxDraw.
2. ⚠️ Known limitation: while a vector is actively edited via MapboxDraw, its rendering uses MapboxDraw's fixed top slot — strict cross-vector ordering with the edit-target is not panel-driven during the edit session. This is acceptable per spec.
3. Save the edit → display layer becomes visible with the saved geometry. Cross-vector z-order matches panel.
4. Close A from panel → A disappears from map.

- [ ] **Step 8: Commit**

```bash
git add client/src/src/template/vector/vectorEdit.tsx
git commit -m "feat(vectorEdit): own per-vector display layer; hide during edit

While MapboxDraw is active for interactive edit, the per-vector display
layer is hidden. On cleanup or save, the latest draw geometry is written
back into the display source so the vector remains visible when leaving
the edit view, with panel-driven z-order.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: vectorCreation — empty display source on mount; populate on save

**Files:**
- Modify: `client/src/src/template/vector/vectorCreation.tsx`

- [ ] **Step 1: Add imports**

Same imports as Task 5 step 1.

- [ ] **Step 2: Extend PageContext**

Add `displayHandle: VectorDisplayHandle | null` to `PageContext` and to the ref initial value.

- [ ] **Step 3: Create empty display layer on mount**

Inside `loadContext`, after lock acquisition and BEFORE `changeMode` calls:

```ts
const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const handle = addVectorDisplay(map, node.nodeInfo, empty)
handle.setVisible(false)
pageContext.current.displayHandle = handle
layerOrderCoordinator.register(node.nodeInfo, handle.mapboxLayerIds)
```

- [ ] **Step 4: Cleanup**

Update both `__cleanup.vectorCreation` callbacks:

```ts
vectorCreation: () => {
    const featureIds = Array.from(pageContext.current.checkedVectorIds)
    const handle = pageContext.current.displayHandle
    if (handle) {
        const fc: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: drawInstance.getAll().features.filter((f: any) =>
                f.properties?.session_id === node.nodeInfo
            ) as any,
        }
        const hex = getHexColorByValue(pageContext.current.vectorData?.color ?? 'sky-500')
        tagVectorColor(fc, hex)
        handle.setData(fc)
        handle.setVisible(true)
        handle.remove()
        pageContext.current.displayHandle = null
    }
    drawInstance.delete(featureIds)
    pageContext.current.checkedVectorIds.clear()
    layerOrderCoordinator.unregister(node.nodeInfo)
}
```

- [ ] **Step 5: On save, populate display source**

After save success in the save handler:

```ts
const fc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: drawInstance.getAll().features.filter((f: any) =>
        f.properties?.session_id === node.nodeInfo
    ) as any,
}
const hex = getHexColorByValue(pageContext.current.vectorData.color)
tagVectorColor(fc, hex)
pageContext.current.displayHandle?.setData(fc)
```

- [ ] **Step 6: Build & smoke**

```bash
cd client/src && npm run build
```

Smoke: Create a new vector, draw a polygon, save → display layer shows it at panel-defined position.

- [ ] **Step 7: Commit**

```bash
git add client/src/src/template/vector/vectorCreation.tsx
git commit -m "feat(vectorCreation): own per-vector display layer

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Per-patch CustomLayerGroup in topologyLayerManager

**Background:** The legacy global `CustomLayerGroup` (`store.get('clg')`) wraps a single mapbox layer that holds all `TopologyLayer` instances. With one wrapper for all patches, mapbox can only move them as a group. To enable per-patch z-ordering by panel, each patch must have its **own** mapbox layer. We do that by creating one `CustomLayerGroup` per patch and adding it as a separate map layer with id `patch-clg-{nodeKey}`.

**Files:**
- Modify: `client/src/src/views/mapView/topology/topologyLayerManager.ts`

- [ ] **Step 1: Rewrite `getOrCreateTopologyLayer`**

```ts
import { Map } from 'mapbox-gl'
import CustomLayerGroup from './customLayerGroup'
import TopologyLayer from './TopologyLayer'

type TopologyLayerWithInitPromise = TopologyLayer & { __nh_initPromise?: Promise<void> }

export interface PerPatchTopology {
    clg: CustomLayerGroup
    clgId: string             // mapbox layer id of the per-patch CLG
    topologyLayer: TopologyLayer
}

export function getOrCreatePerPatchTopology(
    map: Map,
    nodeKey: string,
    topologyLayerId: string,
): PerPatchTopology {
    const clgId = `patch-clg-${nodeKey}`

    if (map.getLayer(clgId)) {
        // already mounted — find the wrapping CLG via map.style internal? Safer: rebuild ref from map.getLayer cast.
        const existing = map.getLayer(clgId) as unknown as CustomLayerGroup
        const existingTL = existing.getLayerInstance(topologyLayerId) as TopologyLayer | null
        if (existingTL) {
            return { clg: existing, clgId, topologyLayer: existingTL }
        }
        const tl = new TopologyLayer(map)
        tl.id = topologyLayerId
        existing.addLayer(tl)
        return { clg: existing, clgId, topologyLayer: tl }
    }

    const clg = new CustomLayerGroup()
    clg.id = clgId
    map.addLayer(clg as unknown as mapboxgl.CustomLayerInterface)

    const tl = new TopologyLayer(map)
    tl.id = topologyLayerId
    clg.addLayer(tl)

    return { clg, clgId, topologyLayer: tl }
}

export async function ensureTopologyLayerInitialized(layer: TopologyLayer, map: Map): Promise<void> {
    const typed = layer as TopologyLayerWithInitPromise
    if (!typed.__nh_initPromise) {
        typed.__nh_initPromise = layer.initialize(map, map.painter.context.gl)
    }
    await typed.__nh_initPromise
}

// Keep old export as deprecated shim during migration (remove in Task 9 cleanup pass)
export function getOrCreateTopologyLayer(
    clg: CustomLayerGroup,
    map: Map,
    layerId: string,
): TopologyLayer {
    const existing = clg.getLayerInstance(layerId) as TopologyLayer | null
    if (existing) return existing
    const layer = new TopologyLayer(map)
    layer.id = layerId
    clg.addLayer(layer)
    return layer
}
```

(`mapboxgl` is imported from `mapbox-gl` — add `import mapboxgl from 'mapbox-gl'` at the top.)

- [ ] **Step 2: Build**

```bash
cd client/src && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add client/src/src/views/mapView/topology/topologyLayerManager.ts
git commit -m "feat(topology): add per-patch CustomLayerGroup factory

Each patch now gets its own mapbox custom layer (id: patch-clg-{nodeKey}),
enabling per-patch z-ordering via map.moveLayer.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Migrate patchCheck/patchEdit to per-patch CLG + register with coordinator

**Files:**
- Modify: `client/src/src/template/patch/patchCheck.tsx` (lines 88, 99, 119-120, 146-147)
- Modify: `client/src/src/template/patch/patchEdit.tsx` (lines 50, 204, 232, 260)
- Modify: `client/src/src/template/patch/patchCreation.tsx` (similar pattern if it touches CLG)

- [ ] **Step 1: patchCheck.tsx — replace global CLG access with per-patch**

Add imports near existing:

```ts
import { getOrCreatePerPatchTopology } from '@/views/mapView/topology/topologyLayerManager'
import { layerOrderCoordinator } from '@/views/mapView/layerOrderCoordinator'
```

Extend `PageContext` (find the interface) with: `perPatchCLGId: string | null`. Initialize in the ref.

Replace the block at lines 88-105 (`const clg = await waitForCustomLayerGroup() ... gridLayer.patchCore = patchCore` → `pageContext.current.topologyLayer = gridLayer`):

```ts
const { clg: _clg, clgId, topologyLayer: gridLayer } = getOrCreatePerPatchTopology(
    map, node.nodeInfo, topologyLayerId,
)
pageContext.current.perPatchCLGId = clgId

const patchCore: PatchCore = new PatchCore(gridContext)
await ensureTopologyLayerInitialized(gridLayer, map)

gridLayer.patchCore = patchCore
pageContext.current.topologyLayer = gridLayer

layerOrderCoordinator.register(node.nodeInfo, [clgId])
```

Replace BOTH `__cleanup.topology` callbacks (lines 118-123 and 145-150):

```ts
topology: () => {
    const id = pageContext.current.perPatchCLGId
    if (id && map.getLayer(id)) map.removeLayer(id)
    pageContext.current.perPatchCLGId = null
    pageContext.current.topologyLayer = null
    layerOrderCoordinator.unregister(node.nodeInfo)
},
```

- [ ] **Step 2: patchEdit.tsx — same pattern**

Imports:

```ts
import { getOrCreatePerPatchTopology } from '@/views/mapView/topology/topologyLayerManager'
import { layerOrderCoordinator } from '@/views/mapView/layerOrderCoordinator'
```

Extend its `PageContext` with `perPatchCLGId: string | null`.

Replace the call at line ~204:

```ts
// before:
// const gridLayer = getOrCreateTopologyLayer(clg, map, topologyLayerId)
// after:
const { clgId, topologyLayer: gridLayer } = getOrCreatePerPatchTopology(
    map, node.nodeInfo, topologyLayerId,
)
pageContext.current.perPatchCLGId = clgId
layerOrderCoordinator.register(node.nodeInfo, [clgId])
```

(Remove the preceding `const clg = await waitForCustomLayerGroup()` if it exists.)

For BOTH cleanups at lines ~232 and ~260, replace:

```ts
// before:
// const clg = store.get<CustomLayerGroup>('clg')
// clg?.removeLayer(topologyLayerId)
// after:
const id = pageContext.current.perPatchCLGId
if (id && map.getLayer(id)) map.removeLayer(id)
pageContext.current.perPatchCLGId = null
layerOrderCoordinator.unregister(node.nodeInfo)
```

- [ ] **Step 3: patchCreation.tsx — apply same pattern if present**

Search for `getOrCreateTopologyLayer` and `store.get<CustomLayerGroup>('clg')` usages in `patchCreation.tsx`. If present, mirror Step 2 changes. (PatchCreation also uses MapboxDraw for rectangle drawing — leave that path untouched.)

- [ ] **Step 4: Build**

```bash
cd client/src && npm run build
```

- [ ] **Step 5: Manual smoke**

1. Open patch P1 in Check view → grid renders.
2. Open patch P2 in Check view → both grids render. Layer panel shows `[P2, P1]`. Map z-order: P2 above P1.
3. Drag-reorder in panel to `[P1, P2]` → map z-order flips, P1 visibly on top.
4. Mix: open vector V + patch P → reorder freely → visual matches panel for any combination.
5. Close P1 → only P2 remains.

- [ ] **Step 6: Commit**

```bash
git add client/src/src/template/patch/
git commit -m "feat(patch): per-patch CLG layer + register with LayerOrderCoordinator

Replaces global CustomLayerGroup access with a per-patch mapbox custom
layer, allowing panel-driven z-ordering across patches and vectors.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Remove global CLG init from MapContainer

**Files:**
- Modify: `client/src/src/views/mapView/mapViewComponent.tsx` (lines 144-148 in the load handler updated by Task 2)
- Modify: `client/src/src/views/mapView/topology/topologyLayerManager.ts` (remove deprecated `getOrCreateTopologyLayer` shim)
- Optionally: `client/src/src/utils/utils.ts` (remove `waitForCustomLayerGroup` if unused)

- [ ] **Step 1: Verify no remaining callsites of the old shim**

```bash
grep -rn "getOrCreateTopologyLayer\b\|waitForCustomLayerGroup\|store.get<CustomLayerGroup>('clg')\|store.get('clg')" client/src/src
```

Expected: only the definitions remain (no application callsites). If any callsite remains, fix it before continuing.

- [ ] **Step 2: Remove global CLG init**

In `mapViewComponent.tsx`, replace the `mapInstance.on('load', ...)` body (set up in Task 2):

```ts
mapInstance.on('load', async () => {
    layerOrderCoordinator.setMap(mapInstance)
})
```

Remove the now-unused `CustomLayerGroup` import and `store.set('clg', ...)`.

- [ ] **Step 3: Remove deprecated shim**

In `topologyLayerManager.ts`, delete the deprecated `getOrCreateTopologyLayer(clg, map, layerId)` function added in Task 7.

- [ ] **Step 4: Remove `waitForCustomLayerGroup` if unused**

```bash
grep -rn "waitForCustomLayerGroup" client/src/src
```

If only the definition remains, delete the function from `utils/utils.ts`.

- [ ] **Step 5: Build**

```bash
cd client/src && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add client/src/src/views/mapView/mapViewComponent.tsx client/src/src/views/mapView/topology/topologyLayerManager.ts client/src/src/utils/utils.ts
git commit -m "chore(mapView): remove global CustomLayerGroup; per-patch only

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: Build**

```bash
cd client/src && npm run build
```

Expected: clean build.

- [ ] **Step 2: Lint**

```bash
cd client/src && npm run lint
```

Expected: no new lint errors introduced by the changes.

- [ ] **Step 3: Manual scenarios**

Run `npm start` and walk through:

1. **Two vectors only** — open V1 (color sky) then V2 (color rose). Panel: `[V2, V1]`. Map: V2 dashed line on top of V1. Pan around — order does not flip.
2. **Drag reorder vectors** — drag V1 above V2 in panel. Map: V1 now on top.
3. **Two patches** — open P1 then P2. Panel: `[P2, P1]`. Map: P2 grid on top.
4. **Drag reorder patches** — drag P1 above P2. Map: P1 grid on top.
5. **Mixed** — V + P + V + P interleaved. Drag freely. Map z-order always matches panel.
6. **Close** — close any node. Only that node's mapbox layer(s) disappear; others unchanged.
7. **Vector edit** — open V1 in Edit view, modify a polygon, save. Display layer reflects the saved geometry; close V1 → it disappears.
8. **Vector creation** — create new vector V3, draw a polygon, save. V3 appears with correct color at top of panel and top of map.
9. **Patch creation** — create new patch with rectangle drawing (uses MapboxDraw). Drawing UX still works.
10. **Tooling layers stay on top** — Schema bounds and grid creation highlights remain above all coordinator-managed layers regardless of reordering.

- [ ] **Step 4: Document any deviations**

If any scenario fails, file the deviation in this plan as a follow-up note BEFORE marking the plan done.

- [ ] **Step 5: Final commit (if any tweaks were needed)**

```bash
git status
git add -A && git commit -m "chore: post-verification fixes for unified layer z-order

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Notes & Risks

- **MapboxDraw fixed slot**: vectors actively being edited (vectorEdit/vectorCreation) appear in MapboxDraw's fixed top slot during the edit session. Cross-vector ordering with the in-edit vector is not strictly panel-driven during that window. Acceptable per spec.
- **Tooling layers**: schema bounds + grid creation highlights are intentionally NOT registered with the coordinator. Confirm those layers are added AFTER the per-vector / per-patch layers so they naturally sit on top, OR that the coordinator's `apply()` walk does not touch them (it only touches ids it owns — confirmed in Task 1).
- **Style reload**: if mapbox style changes at runtime, all mapbox layers would be wiped. The coordinator's `isStyleLoaded` guard handles initial-load timing but not mid-session style swaps. Out of scope.
- **Performance**: `apply()` runs per store-change. With ≤ ~50 layers expected, the cost of `moveLayer` calls is negligible. If panel grows large, debounce in a follow-up.
