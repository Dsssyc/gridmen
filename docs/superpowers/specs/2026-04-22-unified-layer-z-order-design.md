# Unified Layer Z-Order System

**Date**: 2026-04-22
**Status**: Approved (pending user spec review)

## Problem

The Layer panel order does not control map rendering order. Symptoms:

- Two vectors opened in sequence: panel order looks reasonable initially, but after panning the map the cross-vector z-order can flip (e.g. fishpondline ends up on top of fishpond).
- Recently we reversed panel insertion to QGIS convention (newly added on top), but map z-order is still independent of panel order.
- A user dragging items in the panel expects WYSIWYG — the topmost item in the panel should render on top on the map.

## Root cause

Three independent rendering systems coexist on the same map, none of which honor the panel order:

| System | Used by | Mapbox layers | Internal ordering |
|---|---|---|---|
| **MapboxDraw** (one shared instance) | All vectors | Fixed style layer set (line/polygon-fill/polygon-stroke/point/...) | None — z is fixed by the styles array; intra-style-layer order = feature insertion + Draw's internal re-sort on `setData` |
| **CustomLayerGroup (CLG)** (singleton) | Patch (WebGL) | One mapbox custom layer hosting many `NHCustomLayerInterface` instances | Internal `z_order` + `sortLayer()`, but the CLG itself occupies one fixed slot in the global mapbox layer stack |
| **Bare mapbox layers** | Schema bounds, ad-hoc tooling | N independent layers | Driven by `addLayer(beforeId)` / `moveLayer` |

Hard architectural consequence: with all vectors sharing one MapboxDraw, "vectorA above vectorB" is not actually a z-order question — both vectors are features in the **same** mapbox layer, so the answer depends on Draw's internal feature ordering. To get true panel-driven freedom, every panel item must own its own mapbox layer(s).

## Design

### Core idea

Each Layer-panel item ↔ **its own** dedicated set of mapbox layers it owns. A central `LayerOrderCoordinator` is the single source of truth that translates "panel order" → `map.moveLayer(id, beforeId)` calls so the global mapbox layer stack matches the panel exactly.

Convention: **panel top = map top** (matches QGIS/ArcGIS).

### Component changes

#### 1. Vector display layers — independent per vector

For each loaded vector node, register its own:
- source: `vec-src-{nodeKey}` (GeoJSON)
- layers (only those needed by the geometry types present):
  - `vec-fill-{nodeKey}` (polygon fill)
  - `vec-line-{nodeKey}` (polygon stroke + lines)
  - `vec-circle-{nodeKey}` (points)

Paint expressions reference `["get", "color"]` so per-feature hex colors continue to work. `vectorCheck.tsx` and the view-only path of `vectorEdit.tsx` / `vectorCreation.tsx` switch from `drawInstance.add(...)` to writing GeoJSON into this source.

#### 2. MapboxDraw is no longer used for vector display

MapboxDraw stays as a **globally-available interactive drawing tool** (still init'd at map load — patchCreation and other flows depend on it for rectangle drawing). What changes:

- No vector is **displayed** through MapboxDraw anymore. Display goes through per-vector mapbox layers (item #1).
- When a vector enters edit/creation mode (vectorEdit / vectorCreation):
  1. Its own display layers (`vec-fill-{nodeKey}` etc.) are hidden via `setLayoutProperty(id, 'visibility', 'none')`.
  2. Its features are pushed into the global MapboxDraw via `drawInstance.add(...)` for interactive editing.
  3. On save/cancel, MapboxDraw features are written back into `vec-src-{nodeKey}` source via `setData(...)`, MapboxDraw features are deleted (`drawInstance.delete(ids)`), and the display layers are unhidden.
- At any point in time, **at most one vector lives inside MapboxDraw**. Cross-vector z-order ambiguity is therefore eliminated — the actively-edited vector temporarily takes MapboxDraw's fixed slot, which is acceptable.

#### 3. Patch — own CLG per patch

- Drop the global shared CLG from `mapViewComponent.tsx`.
- Each patch gets its own `CustomLayerGroup` instance hosting its own `TopologyLayer`. Each per-patch CLG is registered as an independent mapbox custom layer with id `patch-clg-{nodeKey}`.
- `customLayerGroup.ts` keeps the class (its `mercatorCenter*` / `relativeEyeMatrix` infra is per-instance and still useful) but loses singleton status.
- `topologyLayerManager.getOrCreateTopologyLayer` is rewritten to:
  1. create a new `CustomLayerGroup` instance (per nodeKey)
  2. create the `TopologyLayer`, add to that CLG
  3. `map.addLayer(perPatchCLG)`
  4. return the `TopologyLayer`

#### 4. LayerOrderCoordinator (new)

New module: `client/src/src/views/mapView/layerOrderCoordinator.ts`.

Responsibilities:
- Maintain a `Map<panelLayerId, mapboxLayerIds[]>` ownership table.
- Subscribe to `useLayerStore.layers` and call `apply()` on change.
- `apply()` walks the current panel **bottom → top**, and for each owner's layers calls `map.moveLayer(id)` (no `beforeId`) so each subsequent owner ends up above the previous. Final mapbox stack from bottom to top mirrors panel from bottom to top.

Public API:
```ts
register(panelLayerId: string, mapboxLayerIds: string[]): void
unregister(panelLayerId: string): void
apply(): void   // also auto-called on store changes
setMap(map: mapboxgl.Map): void
```

Tooling layers (schema bounds, grid creation highlights, hover overlays) are **NOT** registered with the coordinator — they live above all coordinator-managed layers and are managed ad hoc by their owners (matches current behavior, simplest).

#### 5. store/storeSet.ts

- Keep the recently-introduced prepend in `addNodeToLayerGroup` (newly added → top of panel).
- No store-level change required for ordering; the coordinator subscribes to `useLayerStore`.

### Data flow

```
Open vector A
  vectorCheck.mount
    → fetch geojson
    → map.addSource(vec-src-A, …); map.addLayer(vec-fill-A); map.addLayer(vec-line-A)
    → coord.register('A', ['vec-fill-A', 'vec-line-A'])
    → useLayerStore.addNodeToLayerGroup(A)   // panel: [A, …]
    → store change → coord.apply()           // mapbox: […, vec-fill-A, vec-line-A]

Open patch B
  patchCheck.mount
    → new CLG; new TopologyLayer; CLG.addLayer(topo)
    → map.addLayer(patchCLG-B)
    → coord.register('B', ['patch-clg-B'])
    → addNodeToLayerGroup(B)                 // panel: [B, A, …]
    → coord.apply()                          // mapbox: […, vec-*-A, patch-clg-B]  (B on top)

Drag A above B in panel
  → useLayerStore.setLayers(...)             // panel: [A, B, …]
  → coord.apply()                            // mapbox: […, patch-clg-B, vec-*-A]

Edit vector A
  vectorEdit.mount (view portion: same as vectorCheck — display via vec-*-A layers)
  user enters edit mode
    → setLayoutProperty('vec-*-A', 'visibility', 'none')
    → drawInstance.add(featureCollection_of_A)
  on save/cancel
    → write features back into vec-src-A via setData(...)
    → drawInstance.delete(ids of A's features)
    → setLayoutProperty('vec-*-A', 'visibility', 'visible')
```

### Ownership / lifecycle table

| Owner template | On mount | On unmount |
|---|---|---|
| `vectorCheck` | addSource + addLayer(s); `coord.register` | removeLayer(s) + removeSource; `coord.unregister` |
| `vectorEdit` (mount, view portion) | same as `vectorCheck` (display via own layers) | same |
| `vectorEdit` (enter edit mode) | hide own display layers; push features into global MapboxDraw | on save: write features back to own source; delete from MapboxDraw; unhide display layers |
| `vectorCreation` (mount) | create empty source + layer(s); `coord.register` | removeLayer(s) + removeSource; `coord.unregister` |
| `vectorCreation` (drawing) | push pending features into MapboxDraw | on save: write back to source; delete from MapboxDraw; unhide |
| `patchCheck` / `patchEdit` / `patchCreation` | new per-patch CLG; addLayer; `coord.register` | removeLayer(perPatchCLG); `coord.unregister` |
| Schema bounds, tooling | unchanged — addLayer directly, always-top | unchanged |
| Global MapboxDraw | created once at map init (unchanged); used by patchCreation rectangle, vectorEdit interactive edit, etc. | n/a |

### Edge cases

- **Map style not yet loaded**: coordinator must guard `map.moveLayer` calls until `map.isStyleLoaded()`. If not ready, queue and apply on `map.on('style.load')`.
- **Layer not yet added**: if a `register` happens before the underlying mapbox layer exists, `apply()` will skip missing ids; owners must call `register` AFTER `map.addLayer`.
- **Tooling layers above coordinator-managed layers**: tools call `map.addLayer(toolLayer)` (no beforeId → top). After `coord.apply()` runs, tools may slip back below; coordinator's `apply()` MUST NOT touch unregistered layer ids. Verified by current API design.
- **Panel `LayerType === 'group'`**: groups themselves don't own mapbox layers — coordinator iterates only `Layer` items recursively in panel order.
- **TopologyLayer's dependence on CLG fields** (`mercatorCenterX`, `relativeEyeMatrix`): preserved — per-patch CLG is a full instance with these populated each frame.

### Risks

- **Wide blast radius**: every vector/patch template touches map-rendering code. High test surface.
- **MapboxDraw recreation cost**: re-instantiating MapboxDraw on each edit session — should be acceptable for interactive edits but worth checking.
- **Style layer collision**: per-vector layer ids are derived from nodeKey; nodeKeys contain dots — already used elsewhere, but verify mapbox accepts them or normalize.

### Out of scope

- Layer **opacity** UI integration (already exists on the `Layer` model but not wired here).
- Layer **visibility** toggle re-implementation — should keep working through the existing store (`visible` flag → set layer visibility).
- DEM / future layer types — coordinator's `register` API is generic, so future types just need to call `register` correctly when they're added.

## Files touched

| File | Change |
|---|---|
| `client/src/src/views/mapView/layerOrderCoordinator.ts` | **New** module |
| `client/src/src/views/mapView/mapViewComponent.tsx` | Remove global CLG creation; init coordinator with map; **keep** global MapboxDraw |
| `client/src/src/views/mapView/topology/customLayerGroup.ts` | No structural change — still a class; remove any singleton-style assumptions |
| `client/src/src/views/mapView/topology/topologyLayerManager.ts` | Each call creates a new per-patch CLG and `map.addLayer` it |
| `client/src/src/template/vector/vectorCheck.tsx` | Switch display from MapboxDraw to per-vector mapbox source/layers; register w/ coordinator |
| `client/src/src/template/vector/vectorEdit.tsx` | Display via per-vector mapbox layers; on entering edit mode push features into existing global MapboxDraw, hide own layers; on save write back |
| `client/src/src/template/vector/vectorCreation.tsx` | Same pattern as vectorEdit; on save register newly-created vector |
| `client/src/src/template/patch/patchCheck.tsx` | Use per-patch CLG; register w/ coordinator |
| `client/src/src/template/patch/patchEdit.tsx` | Same |
| `client/src/src/template/patch/patchCreation.tsx` | Same |
| `client/src/src/store/storeSet.ts` | No structural change; keep prepend in `addNodeToLayerGroup` |
| `client/src/src/utils/utils.ts` | Schema bounds — no change (always-top) |

## Acceptance criteria

1. Open vector A then vector B — panel shows `[B, A]`, map shows B's geometries above A's. After panning the map, the order does not flip.
2. Open patch P then vector V — panel shows `[V, P]`, map shows V above P. Drag P above V in panel — map updates to show P above V immediately.
3. Open multiple vectors and multiple patches in any combination, drag-reorder freely — final map z-order always equals panel order.
4. Editing a vector still works (selection, modify, save). After save, the vector is shown in its panel-defined position (not stuck on top because of MapboxDraw).
5. Schema bounds and grid-creation tooling layers continue to render above all data layers (existing behavior preserved).
