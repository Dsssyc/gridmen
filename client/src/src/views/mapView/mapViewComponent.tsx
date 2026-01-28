
import { useEffect, useRef, forwardRef, useState, useCallback } from 'react'
import { create } from 'zustand'
import mapboxgl from 'mapbox-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
// @ts-expect-error no declare file for rectangle mode
import DrawRectangle from 'mapbox-gl-draw-rectangle-mode'
import ToolPanel from './toolPanel'
import LayerGroup from './layerGroup'
import 'mapbox-gl/dist/mapbox-gl.css'
import store from '@/store/store'
import { useSettingStore } from '@/store/storeSet'
import MapView, { MapViewContext } from './mapView'
import { VIEW_REGISTRY } from '@/registry/viewRegistry'
import { IResourceNode } from '@/template/scene/iscene'
import CustomLayerGroup from './topology/customLayerGroup'
import { calculateRectangleCoordinates, debounce } from '@/utils/utils'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

const initialZoom = 11
const maxZoom = 22

let resizer: ResizeObserver | null = null

interface MapContainerProps {
    onMapLoad?: (map: mapboxgl.Map) => void
    onDrawReady?: (draw: MapboxDraw) => void
}

const mapCanvasDebounce = (map: mapboxgl.Map, delay: number, mapRef: HTMLDivElement) => {
    resizer = new ResizeObserver(
        debounce(() => {
            map?.resize()
        }, delay)
    )
    resizer.observe(mapRef)
}

const useMapStore = create<MapViewContext>((set) => ({
    map: null,
    drawInstance: null,
    setMap: (map: mapboxgl.Map) => set({ map }),
    setDrawInstance: (drawInstance: MapboxDraw) => set({ drawInstance }),
}))

const MapContainer = forwardRef<HTMLDivElement, MapContainerProps>(({ onMapLoad, onDrawReady }, ref) => {

    const isProcessingDrawEventRef = useRef(false)
    const drawInstanceRef = useRef<MapboxDraw | null>(null)

    const initializedRef = useRef(false)
    const mapWrapperRef = useRef<HTMLDivElement>(null)

    const mapInitialLongitude = useSettingStore((s) => s.mapInitialLongitude)
    const mapInitialLatitude = useSettingStore((s) => s.mapInitialLatitude)

    const { setMap, setDrawInstance } = useMapStore()
    const mapFromStore = useMapStore((s) => s.map)

    // Keep existing map centered on the configured initial center.
    // This also makes settings changes immediately reflect on the map.
    useEffect(() => {
        if (!mapFromStore) return
        mapFromStore.easeTo({ center: [mapInitialLongitude, mapInitialLatitude], duration: 300 })
    }, [mapFromStore, mapInitialLongitude, mapInitialLatitude])

    const handleDrawCreate = useCallback((e: any) => {
        if (isProcessingDrawEventRef.current) return

        isProcessingDrawEventRef.current = true
        try {
            const draw = drawInstanceRef.current
            if (!draw) return

            if (e.features && e.features.length > 0) {
                const feature = e.features[0]
                if (draw.getMode() === 'draw_rectangle' && feature?.geometry?.type === 'Polygon') {
                    const coordinates = calculateRectangleCoordinates(feature)
                    const drawCompleteEvent = new CustomEvent('rectangle-draw-complete', {
                        detail: { coordinates }
                    })
                    document.dispatchEvent(drawCompleteEvent)
                    draw.changeMode('simple_select')
                }
            }
        } finally {
            isProcessingDrawEventRef.current = false
        }
    }, [])

    useEffect(() => {
        mapboxgl.accessToken = import.meta.env.VITE_MAP_TOKEN
        const currentMapWrapper = mapWrapperRef.current

        if (currentMapWrapper && !initializedRef.current) {
            initializedRef.current = true

            const currentMap = useMapStore.getState().map

            if (currentMap) {
                try {
                    const oldContainer = currentMap.getContainer()
                    if (oldContainer && oldContainer.parentNode) {
                        oldContainer.parentNode.removeChild(oldContainer)
                    }
                } catch (e) {
                    console.warn('Failed to remove old container:', e)
                }

                currentMapWrapper.appendChild(currentMap.getContainer())
                currentMap.resize()

                onMapLoad!(currentMap)

                mapCanvasDebounce(currentMap, 100, currentMapWrapper)

            } else {
                const { mapInitialLongitude: lng, mapInitialLatitude: lat } = useSettingStore.getState()
                const mapInstance = new mapboxgl.Map({
                    container: currentMapWrapper,
                    style: 'mapbox://styles/mapbox/streets-v12',
                    projection: 'globe',
                    center: [lng, lat],
                    zoom: initialZoom,
                    maxZoom: maxZoom,
                    pitch: 0,
                    pitchWithRotate: false,
                    attributionControl: false,
                    boxZoom: false,
                })

                mapInstance.on('style.load', () => {
                    mapInstance.setFog({})
                })

                mapInstance.on('load', async () => {
                    const layerGroup = new CustomLayerGroup()
                    layerGroup.id = 'gridman-custom-layer-group'
                    mapInstance.addLayer(layerGroup)
                    store.set('clg', layerGroup)
                })

                const drawColor = '#F06B00'
                const drawColorExpr: any = ['coalesce', ['get', 'user_color'], drawColor]

                const MapboxDrawAny = MapboxDraw as any
                const draw = new MapboxDrawAny({
                    displayControlsDefault: false,
                    boxSelect: false,
                    userProperties: true,
                    modes: {
                        ...MapboxDrawAny.modes,
                        draw_rectangle: DrawRectangle
                    },
                    styles: [
                        // Active point style
                        {
                            'id': 'gl-draw-point-active',
                            'type': 'circle',
                            'filter': ['all', ['==', '$type', 'Point'], ['==', 'active', 'true']],
                            'paint': {
                                'circle-radius': 7,
                                'circle-color': drawColorExpr
                            }
                        },
                        // Inactive point style
                        {
                            'id': 'gl-draw-point',
                            'type': 'circle',
                            'filter': ['all', ['==', '$type', 'Point'], ['==', 'active', 'false']],
                            'paint': {
                                'circle-radius': 5,
                                'circle-color': drawColorExpr
                            }
                        },
                        // Line style
                        {
                            'id': 'gl-draw-line',
                            'type': 'line',
                            'filter': ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
                            'layout': {
                                'line-cap': 'round',
                                'line-join': 'round'
                            },
                            'paint': {
                                'line-color': drawColorExpr,
                                'line-width': 2,
                                'line-dasharray': [2, 2]
                            }
                        },
                        // Polygon fill style
                        {
                            'id': 'gl-draw-polygon-fill',
                            'type': 'fill',
                            'filter': ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                            'paint': {
                                'fill-color': drawColorExpr,
                                'fill-outline-color': drawColorExpr,
                                'fill-opacity': 0.1
                            }
                        },
                        // Polygon outline style
                        {
                            'id': 'gl-draw-polygon-stroke',
                            'type': 'line',
                            'filter': ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                            'layout': {
                                'line-cap': 'round',
                                'line-join': 'round'
                            },
                            'paint': {
                                'line-color': drawColorExpr,
                                'line-width': 2,
                                'line-dasharray': [2, 2]
                            }
                        },
                        // Vertex style
                        {
                            'id': 'gl-draw-point-mid-point',
                            'type': 'circle',
                            'filter': ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
                            'paint': {
                                'circle-radius': 4,
                                'circle-color': drawColorExpr
                            }
                        },
                        // Vertex point style
                        {
                            'id': 'gl-draw-point-and-mid',
                            'type': 'circle',
                            'filter': ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']],
                            'paint': {
                                'circle-radius': 5,
                                'circle-color': drawColorExpr
                            }
                        }
                    ]
                })

                mapInstance.addControl(draw)
                drawInstanceRef.current = draw
                setDrawInstance(draw)
                onDrawReady?.(draw)

                mapInstance.on('draw.create', handleDrawCreate)

                onMapLoad!(mapInstance)

                setMap(mapInstance)

                mapCanvasDebounce(mapInstance, 100, currentMapWrapper)
            }
        }

        return () => {
            initializedRef.current = false

            const currentMap = useMapStore.getState().map
            if (currentMap) {
                currentMap.off('draw.create', handleDrawCreate)
            }

            if (resizer && currentMapWrapper) {
                resizer.unobserve(currentMapWrapper)
                resizer.disconnect()
            }
        }

    }, [onMapLoad, onDrawReady, setMap, setDrawInstance, handleDrawCreate])

    return (
        <div className="flex h-full items-center justify-center">
            <div className='relative w-full h-full hide-mapbox-branding' ref={mapWrapperRef} />
        </div>
    )
})

interface MapViewComponentProps {
    templateName?: string
    selectedNode?: IResourceNode | null
    getResourceNodeByKey?: (key: string) => IResourceNode | null
}

export default function MapViewComponent({ templateName = 'default', selectedNode = null, getResourceNodeByKey }: MapViewComponentProps) {

    const [mapInstance, setMapInstance] = useState<mapboxgl.Map | null>(null)
    const [drawInstance, setDrawInstance] = useState<MapboxDraw | null>(null)

    const viewConfig = VIEW_REGISTRY[MapView.classKey]
    const viewModels = viewConfig?.viewModels || null

    const handleMapLoad = useCallback((map: mapboxgl.Map) => {
        setMapInstance(map)
    }, [])

    const handleDrawReady = useCallback((draw: MapboxDraw) => {
        setDrawInstance(draw)
    }, [])

    return (
        <ResizablePanelGroup
            direction="horizontal"
            className="h-full w-full text-white "
        >
            <ResizablePanel defaultSize={14}>
                <LayerGroup getResourceNodeByKey={getResourceNodeByKey} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={61}>
                <MapContainer onMapLoad={handleMapLoad} onDrawReady={handleDrawReady} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={25}>
                <ToolPanel
                    viewModels={viewModels}
                    mapContainer={mapInstance}
                    drawInstance={drawInstance}
                    templateName={templateName}
                    selectedNode={selectedNode}
                />
            </ResizablePanel>
        </ResizablePanelGroup >
    )
}
