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
