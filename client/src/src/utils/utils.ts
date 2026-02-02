import proj4 from 'proj4'
import mapboxgl from 'mapbox-gl'
import { twMerge } from "tailwind-merge"
import { clsx, type ClassValue } from "clsx"
import * as apis from '@/template/api/apis'
import CustomLayerGroup from '@/views/mapView/topology/customLayerGroup'
import store from '@/store/store'

export const vectorColorMap = [
    { value: "sky-500", color: "#0ea5e9", name: "Sky" },
    { value: "green-500", color: "#22c55e", name: "Green" },
    { value: "red-500", color: "#ef4444", name: "Red" },
    { value: "purple-500", color: "#a855f7", name: "Purple" },
    { value: "yellow-300", color: "#FFDF20", name: "Yellow" },
    { value: "orange-500", color: "#FF6900", name: "Orange" },
    { value: "pink-500", color: "#ec4899", name: "Pink" },
    { value: "indigo-500", color: "#6366f1", name: "Indigo" }
]

export const getHexColorByValue = (value: string | undefined | null) => {
    if (!value) return "#0ea5e9"
    return vectorColorMap.find((item) => item.value === value)?.color ?? "#0ea5e9"
}

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export const convertPointCoordinate = async (originPoint: [number, number], fromEPSG: number, toEPSG: number): Promise<[number, number] | null> => {
    const lon = originPoint[0]
    const lat = originPoint[1]

    const fromEPSGDefs = await apis.proj.getProj4Defs(fromEPSG)
    const toEPSGDefs = await apis.proj.getProj4Defs(toEPSG)

    if (!lon || !lat || !fromEPSG || !toEPSG) return null

    try {
        if (fromEPSGDefs) {
            proj4.defs(`EPSG:${fromEPSG}`, fromEPSGDefs)
        }

        if (toEPSGDefs) {
            proj4.defs(`EPSG:${toEPSG}`, toEPSGDefs)
        }

        const convertedPoint = proj4(`EPSG:${fromEPSG}`, `EPSG:${toEPSG}`, originPoint)
        return convertedPoint
    } catch (error) {
        console.error('Error converting coordinate:', error)
        return null
    }
}

export const waitForMapLoad = (map: mapboxgl.Map) => {
    return new Promise<void>((resolve) => {
        if (map.loaded()) {
            resolve()
        } else {
            map.once('load', () => {
                resolve()
            })
        }
    })
}

export const waitForDrawInstanceLoad = (drawInstance: any) => {
    return new Promise<void>((resolve) => {
        const checkDraw = () => {
            if (drawInstance && typeof drawInstance.changeMode === 'function') {
                resolve()
            } else {
                setTimeout(checkDraw, 100)
            }
        }
        checkDraw()
    })
}

export const waitForCustomLayerGroup = () => {
    return new Promise<CustomLayerGroup>((resolve) => {
        const checkClg = () => {
            const clg = store.get<CustomLayerGroup>('clg')!
            if (clg) {
                resolve(clg)
            } else {
                setTimeout(checkClg, 100)
            }
        }
        checkClg()
    })
}

const markerMap = new Map<string, mapboxgl.Marker>()
const patchBoundsMap = new Map<string, { sourceId: string, fillLayerId: string, outlineLayerId: string }>()

export const clearMapAllMarkers = () => {
    markerMap.forEach((marker) => {
        marker.remove()
    })
    markerMap.clear()
}

export const clearMarkerByNodeKey = (nodeKey: string) => {
    const marker = markerMap.get(nodeKey)
    if (marker) {
        marker.remove()
        markerMap.delete(nodeKey)
    }
}

export const addMapMarker = (
    map: mapboxgl.Map,
    coords: [number, number],
    nodeKey: string,
    options?: mapboxgl.MarkerOptions
) => {
    if (!map || !map.getCanvas() || !coords || coords.length < 2 || !nodeKey) return

    clearMarkerByNodeKey(nodeKey)

    const marker = new mapboxgl.Marker(options)
        .setLngLat([coords[0], coords[1]])
        .addTo(map)

    markerMap.set(nodeKey, marker)
}

export const pickCoordsFromMap = (
    map: mapboxgl.Map,
    nodeKey: string,
    option?: mapboxgl.MarkerOptions,
    callback?: (marker: mapboxgl.Marker) => void
): (() => void) => {

    if (map.getCanvas()) map.getCanvas().style.cursor = 'crosshair'

    const handleMapClick = (e: mapboxgl.MapMouseEvent) => {
        if (map.getCanvas()) map.getCanvas().style.cursor = ''

        const existingMarker = markerMap.get(nodeKey)
        if (existingMarker) {
            existingMarker.remove()
            markerMap.delete(nodeKey)
        }

        const marker = new mapboxgl.Marker({ ...option, anchor: 'center' })
            .setLngLat(e.lngLat)
            .addTo(map)

        markerMap.set(nodeKey, marker)

        callback && callback(marker)
    }

    map.once('click', handleMapClick)

    return () => {
        map.off('click', handleMapClick)
        if (map.getCanvas()) map.getCanvas().style.cursor = ''

        const marker = markerMap.get(nodeKey)
        if (marker) {
            marker.remove()
            markerMap.delete(nodeKey)
        }
    }
}

export interface RectangleCoordinates {
    northEast: [number, number];
    southEast: [number, number];
    southWest: [number, number];
    northWest: [number, number];
    center: [number, number];
}

export const calculateRectangleCoordinates = (feature: any): RectangleCoordinates | null => {
    if (!feature || feature.geometry.type !== 'Polygon') return null

    const coordinates = feature.geometry.coordinates[0]
    if (coordinates.length < 4) return null

    const lngs = coordinates.map((coord: number[]) => coord[0])
    const lats = coordinates.map((coord: number[]) => coord[1])

    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)

    return {
        northEast: [maxLng, maxLat],
        southEast: [maxLng, minLat],
        southWest: [minLng, minLat],
        northWest: [minLng, maxLat],
        center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
    }
}

export const startDrawRectangle = (map: mapboxgl.Map, drawInstance: MapboxDraw) => {
    if (!map || !drawInstance) return

    try {
        drawInstance.deleteAll()
        drawInstance.changeMode('draw_rectangle')
        return true
    } catch (error) {
        console.error('Error starting draw rectangle:', error)
        return false
    }
}

export const stopDrawRectangle = (map: mapboxgl.Map, drawInstance: MapboxDraw) => {
    if (!map || !drawInstance) return

    try {
        drawInstance.changeMode('simple_select')
        drawInstance.deleteAll()
    } catch (error) {
        console.error('Error stopping draw rectangle:', error)
    }
}

export const clearMapAllPatchBounds = (map: mapboxgl.Map) => {
    patchBoundsMap.forEach((bounds, id) => {
        try {
            if (map.getLayer(bounds.fillLayerId)) map.removeLayer(bounds.fillLayerId)
            if (map.getLayer(bounds.outlineLayerId)) map.removeLayer(bounds.outlineLayerId)
            if (map.getSource(bounds.sourceId)) map.removeSource(bounds.sourceId)
        } catch (error) {
            console.error(`Error clearing patch bounds ${id}:`, error)
        }
    })
    patchBoundsMap.clear()
}

export const addMapPatchBounds = (
    map: mapboxgl.Map,
    bounds: [number, number, number, number],
    id: string,
    fit?: boolean,
    options?: {
        fillColor?: string,
        lineColor?: string,
        opacity?: number,
        lineWidth?: number,
    }
) => {
    if (!map || !bounds || bounds.length < 4 || !id) return

    const sourceId = `bounds-source-${id}`
    const fillLayerId = `bounds-fill-${id}`
    const outlineLayerId = `bounds-outline-${id}`

    const addBounds = () => {
        clearMapPatchBounds(map, id)

        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getLayer(outlineLayerId)) map.removeLayer(outlineLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)

        const boundsData = {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [bounds[0], bounds[1]],
                    [bounds[2], bounds[1]],
                    [bounds[2], bounds[3]],
                    [bounds[0], bounds[3]],
                    [bounds[0], bounds[1]]
                ]]
            }
        }

        map.addSource(sourceId, {
            type: 'geojson',
            data: boundsData as GeoJSON.Feature<GeoJSON.Polygon>
        })

        const defaultFillColor = id === 'adjusted-bounds' ? '#00FF00' : '#00A8C2'
        const defaultLineColor = id === 'adjusted-bounds' ? '#FF1A00' : '#0072FF'
        const defaultOpacity = id === 'adjusted-bounds' ? 0.1 : 0.2
        const defaultLineWidth = 2

        const fillColor = options?.fillColor || defaultFillColor
        const lineColor = options?.lineColor || defaultLineColor
        const opacity = options?.opacity !== undefined ? options.opacity : defaultOpacity
        const lineWidth = options?.lineWidth !== undefined ? options.lineWidth : defaultLineWidth

        map.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            layout: {},
            paint: {
                'fill-color': fillColor,
                'fill-opacity': opacity
            }
        })

        map.addLayer({
            id: outlineLayerId,
            type: 'line',
            source: sourceId,
            layout: {},
            paint: {
                'line-color': lineColor,
                'line-width': lineWidth
            }
        })

        if (fit) {
            map.fitBounds([
                [bounds[0], bounds[1]],
                [bounds[2], bounds[3]]
            ], {
                padding: 200,
                duration: 1000
            })
        }

        patchBoundsMap.set(id, { sourceId, fillLayerId, outlineLayerId })
    }

    if (map.isStyleLoaded()) {
        addBounds()
    } else {
        const timeoutId = setTimeout(() => {
            if (map.isStyleLoaded()) {
                addBounds()
            } else {
                // Try again with a longer delay
                const retryId = setTimeout(() => {
                    addBounds()
                }, 100)
                map.once('style.load', () => {
                    clearTimeout(retryId)
                    addBounds()
                })
            }
        }, 100)
    }
}

export const clearMapPatchBounds = (map: mapboxgl.Map, id: string) => {
    if (!map || !id) return

    const bounds = patchBoundsMap.get(id)
    if (!bounds) return

    try {
        if (map.getLayer(bounds.fillLayerId)) map.removeLayer(bounds.fillLayerId)
        if (map.getLayer(bounds.outlineLayerId)) map.removeLayer(bounds.outlineLayerId)
        if (map.getSource(bounds.sourceId)) map.removeSource(bounds.sourceId)
        patchBoundsMap.delete(id)
    } catch (error) {
        console.error(`Error clearing patch bounds ${id}:`, error)
    }
}

export const debounce = <F extends (...args: any[]) => any>(
    func: F,
    delay: number
): (...args: Parameters<F>) => Promise<ReturnType<F>> => {
    let timeoutId: NodeJS.Timeout | null = null

    return (...args: Parameters<F>) => {
        if (timeoutId) {
            clearTimeout(timeoutId)
        }

        return new Promise<ReturnType<F>>((resolve) => {
            timeoutId = setTimeout(() => {
                const result = func(...args)
                timeoutId = null
                resolve(result)
            }, delay)
        })
    }
}

export const adjustPatchBounds = async (
    bounds: [number, number, number, number],
    gridLevel: [number, number],
    fromEPSG: number,
    toEPSG: number,
    alignmentOrigin: [number, number]
): Promise<{
    convertedBounds: [number, number, number, number]
    alignedBounds: [number, number, number, number]
    expandedBounds: [number, number, number, number]
}> => {
    const gridWidth = gridLevel[0]
    const gridHeight = gridLevel[1]

    let convertedSW: [number, number] = [bounds[0], bounds[1]]
    let convertedNE: [number, number] = [bounds[2], bounds[3]]

    if (fromEPSG !== toEPSG) {
        const SW = await convertPointCoordinate([bounds[0], bounds[1]], fromEPSG, toEPSG)      // toEPSG
        const NE = await convertPointCoordinate([bounds[2], bounds[3]], fromEPSG, toEPSG)      // toEPSG
        convertedSW = SW!
        convertedNE = NE!
    }

    const convertedBounds: [number, number, number, number] = [convertedSW[0], convertedSW[1], convertedNE[0], convertedNE[1]]  //toEPSG

    // const calcuSW = await convertPointCoordinate([bounds[0], bounds[1]], fromEPSG, 3857)      // 3857
    // const calcuNE = await convertPointCoordinate([bounds[2], bounds[3]], fromEPSG, 3857)      // 3857
    const tempCalculatedBounds = [convertedSW![0], convertedSW![1], convertedNE![0], convertedNE![1]]

    // const tempCalculatedAlignmentOrigin = await convertPointCoordinate(alignmentOrigin, fromEPSG, 3857)  // 3857

    // const swX = tempCalculatedBounds[0]
    // const swY = tempCalculatedBounds[1]

    const swX = convertedSW[0]
    const swY = convertedSW[1]

    // const baseX = tempCalculatedAlignmentOrigin![0]
    // const baseY = tempCalculatedAlignmentOrigin![1]
    const baseX = alignmentOrigin![0]
    const baseY = alignmentOrigin![1]

    const dX = swX - baseX
    const dY = swY - baseY

    const disX = Math.floor(dX / gridWidth) * gridWidth
    const disY = Math.floor(dY / gridHeight) * gridHeight

    const offsetX = disX - dX
    const offsetY = disY - dY

    const rectWidth = tempCalculatedBounds[2] - tempCalculatedBounds[0]
    const rectHeight = tempCalculatedBounds[3] - tempCalculatedBounds[1]

    const tempAlignSW = [tempCalculatedBounds[0] + offsetX, tempCalculatedBounds[1] + offsetY]
    const tempAlignNE = [tempAlignSW[0] + rectWidth, tempAlignSW[1] + rectHeight]

    // const alignSW = await convertPointCoordinate([tempAlignSW[0], tempAlignSW[1]], 3857, toEPSG)      // toEPSG
    // const alignNE = await convertPointCoordinate([tempAlignNE[0], tempAlignNE[1]], 3857, toEPSG)      // toEPSG

    // console.log('alignSW', alignSW)
    // console.log('alignNE', alignNE)

    const alignedBounds: [number, number, number, number] = [tempAlignSW![0], tempAlignSW![1], tempAlignNE![0], tempAlignNE![1]]  //toEPSG

    const expandedRectWidth = Math.ceil(rectWidth / gridWidth) * gridWidth
    const expandedRectHeight = Math.ceil(rectHeight / gridHeight) * gridHeight

    const tempExpandSW = tempAlignSW
    const tempExpandNE = [tempExpandSW[0] + expandedRectWidth, tempExpandSW[1] + expandedRectHeight]

    // const expandSW = await convertPointCoordinate([tempExpandSW[0], tempExpandSW[1]], 3857, toEPSG)      // toEPSG
    // const expandNE = await convertPointCoordinate([tempExpandNE[0], tempExpandNE[1]], 3857, toEPSG)      // toEPSG

    const expandedBounds: [number, number, number, number] = [tempExpandSW![0], tempExpandSW![1], tempExpandNE![0], tempExpandNE![1]]  //toEPSG

    return {
        convertedBounds: convertedBounds,
        alignedBounds: alignedBounds,
        expandedBounds: expandedBounds,
    }
}

export const calculateGridCounts = (
    southWest: [number, number],
    basePoint: [number, number],
    gridLevel: [number, number]
): {
    widthCount: number,
    heightCount: number
} => {
    const gridWidth = gridLevel[0]
    const gridHeight = gridLevel[1]

    const [swX, swY] = southWest
    const [baseX, baseY] = basePoint

    const widthCount = Math.abs((swX - baseX) / gridWidth)
    const heightCount = Math.abs((swY - baseY) / gridHeight)

    return { widthCount, heightCount }
}

export const convertBoundsCoordinates = async (
    coordinates: [number, number, number, number],
    fromEPSG: number,
    toEPSG: number
): Promise<[number, number, number, number]> => {
    const sw = await convertPointCoordinate([coordinates[0], coordinates[1]], fromEPSG, toEPSG)
    const ne = await convertPointCoordinate([coordinates[2], coordinates[3]], fromEPSG, toEPSG)

    return [sw![0], sw![1], ne![0], ne![1]]
}