import mapboxgl, { Map as MapboxMap } from 'mapbox-gl'
import CustomLayerGroup from './customLayerGroup'
import TopologyLayer from './TopologyLayer'

type TopologyLayerWithInitPromise = TopologyLayer & { __nh_initPromise?: Promise<void> }

export interface PerPatchTopology {
    clg: CustomLayerGroup
    clgId: string
    topologyLayer: TopologyLayer
}

const perPatchCLGs = new Map<string, CustomLayerGroup>()

export function getOrCreatePerPatchTopology(
    map: MapboxMap,
    nodeKey: string,
    topologyLayerId: string,
): PerPatchTopology {
    const clgId = `patch-clg-${nodeKey}`

    let clg = perPatchCLGs.get(clgId) ?? null
    if (clg && !map.getLayer(clgId)) {
        // stale cache (style was reset) — drop and recreate
        perPatchCLGs.delete(clgId)
        clg = null
    }

    if (clg) {
        const existingTL = clg.getLayerInstance(topologyLayerId) as TopologyLayer | null
        if (existingTL) {
            return { clg, clgId, topologyLayer: existingTL }
        }
        const tl = new TopologyLayer(map)
        tl.id = topologyLayerId
        clg.addLayer(tl)
        return { clg, clgId, topologyLayer: tl }
    }

    clg = new CustomLayerGroup()
    clg.id = clgId
    map.addLayer(clg as unknown as mapboxgl.CustomLayerInterface)
    perPatchCLGs.set(clgId, clg)

    const tl = new TopologyLayer(map)
    tl.id = topologyLayerId
    clg.addLayer(tl)

    return { clg, clgId, topologyLayer: tl }
}

export function removePerPatchTopology(map: MapboxMap, nodeKey: string): void {
    const clgId = `patch-clg-${nodeKey}`
    if (map.getLayer(clgId)) {
        map.removeLayer(clgId)
    }
    perPatchCLGs.delete(clgId)
}

export async function ensureTopologyLayerInitialized(layer: TopologyLayer, map: MapboxMap): Promise<void> {
    const typed = layer as TopologyLayerWithInitPromise
    if (!typed.__nh_initPromise) {
        typed.__nh_initPromise = layer.initialize(map, map.painter.context.gl)
    }
    await typed.__nh_initPromise
}
