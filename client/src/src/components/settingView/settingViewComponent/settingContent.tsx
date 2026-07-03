import { useEffect, useRef, useState } from "react"
import mapboxgl from "mapbox-gl"
import SettingItem from "./settingItem"
import { Input } from "@/components/ui/input"
import { DEFAULT_LEAD_IP, useSettingStore } from "@/store/storeSet"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Eye, EyeOff, MapPin } from "lucide-react"
import {
    getMapboxAccessToken,
    isMapboxSecretToken,
    mapboxPublicTokenPrefix,
    mapboxTokenEnvName,
    normalizeMapboxPublicToken,
} from "@/utils/mapboxToken"
import {
    DEFAULT_API_BASE_URL,
    apiBaseUrlEnvNames,
    getApiBaseUrlSource,
    getEffectiveApiBaseUrl,
    normalizeApiBaseUrl,
} from "@/utils/apiBaseUrl"

interface SettingContentProps {
    activeCategory: string
}

export default function SettingContent({ activeCategory }: SettingContentProps) {

    const {
        publicIP: leadIP,
        apiBaseUrlOverride,
        highSpeedMode,
        mapboxAccessToken: savedMapboxAccessToken,
        mapInitialLongitude,
        mapInitialLatitude,
        setHighSpeedMode,
        setLeadIP,
        setApiBaseUrlOverride,
        setMapboxAccessToken,
        setMapInitialCenter,
        setMapInitialLongitude,
        setMapInitialLatitude,
    } = useSettingStore()

    const [showMapboxAccessToken, setShowMapboxAccessToken] = useState(false)
    const [lngInput, setLngInput] = useState(() => String(mapInitialLongitude))
    const [latInput, setLatInput] = useState(() => String(mapInitialLatitude))
    const [pickPopoverOpen, setPickPopoverOpen] = useState(false)

    const mapWrapperRef = useRef<HTMLDivElement>(null)
    const pickMapRef = useRef<mapboxgl.Map | null>(null)
    const pickMarkerRef = useRef<mapboxgl.Marker | null>(null)
    const mapboxAccessToken = getMapboxAccessToken(savedMapboxAccessToken)
    const trimmedApiBaseUrlOverride = apiBaseUrlOverride.trim()
    const apiBaseUrlError = trimmedApiBaseUrlOverride && !normalizeApiBaseUrl(trimmedApiBaseUrlOverride)
        ? `Use an http://, https://, or same-origin path such as /gridmen.`
        : null
    const effectiveApiBaseUrl = getEffectiveApiBaseUrl(apiBaseUrlOverride)
    const apiBaseUrlSource = getApiBaseUrlSource(apiBaseUrlOverride)
    const apiBaseUrlSourceLabel = (() => {
        if (apiBaseUrlSource === 'settings') return 'settings override'
        if (apiBaseUrlSource === 'runtime') return 'runtime override'
        if (apiBaseUrlSource === 'env') return apiBaseUrlEnvNames.join(' / ')
        return 'default'
    })()
    const trimmedMapboxAccessToken = savedMapboxAccessToken.trim()
    const mapboxTokenError = (() => {
        if (!trimmedMapboxAccessToken) return null
        if (isMapboxSecretToken(trimmedMapboxAccessToken)) {
            return "Secret tokens cannot be used in the desktop client. Use a public token that starts with pk."
        }
        if (!normalizeMapboxPublicToken(trimmedMapboxAccessToken)) {
            return "Use a Mapbox public token that starts with pk."
        }
        return null
    })()

    useEffect(() => {
        setLngInput(String(mapInitialLongitude))
    }, [mapInitialLongitude])

    useEffect(() => {
        setLatInput(String(mapInitialLatitude))
    }, [mapInitialLatitude])

    const parseAndClampLngLat = (lngRaw: string, latRaw: string): { lng: number, lat: number } | null => {
        const lng = Number(lngRaw)
        const lat = Number(latRaw)
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
        if (lng < -180 || lng > 180) return null
        if (lat < -90 || lat > 90) return null
        return { lng, lat }
    }

    const commitLng = (raw: string) => {
        const next = parseAndClampLngLat(raw, String(mapInitialLatitude))
        if (!next) {
            setLngInput(String(mapInitialLongitude))
            return
        }
        setMapInitialLongitude(next.lng)
    }

    const commitLat = (raw: string) => {
        const next = parseAndClampLngLat(String(mapInitialLongitude), raw)
        if (!next) {
            setLatInput(String(mapInitialLatitude))
            return
        }
        setMapInitialLatitude(next.lat)
    }

    useEffect(() => {
        if (!pickPopoverOpen) {
            pickMapRef.current?.remove()
            pickMapRef.current = null
            pickMarkerRef.current = null
            return
        }

        if (!mapboxAccessToken) {
            pickMapRef.current?.remove()
            pickMapRef.current = null
            pickMarkerRef.current = null
            return
        }

        mapboxgl.accessToken = mapboxAccessToken

        let disposed = false
        let rafId = 0

        const init = () => {
            if (disposed) return

            const container = mapWrapperRef.current
            if (!container) {
                rafId = requestAnimationFrame(init)
                return
            }

            pickMapRef.current?.remove()
            pickMapRef.current = null
            pickMarkerRef.current = null

            const map = new mapboxgl.Map({
                container,
                style: 'mapbox://styles/mapbox/streets-v12',
                center: [mapInitialLongitude, mapInitialLatitude],
                zoom: 11,
                attributionControl: false,
            })

            // Make cursor a crosshair while picking.
            map.getCanvas().style.cursor = 'crosshair'

            const marker = new mapboxgl.Marker({ color: '#F06B00' })
                .setLngLat([mapInitialLongitude, mapInitialLatitude])
                .addTo(map)

            pickMapRef.current = map
            pickMarkerRef.current = marker

            const handleClick = (e: mapboxgl.MapMouseEvent) => {
                const lng = Number(e.lngLat.lng.toFixed(6))
                const lat = Number(e.lngLat.lat.toFixed(6))
                marker.setLngLat([lng, lat])
                setMapInitialCenter(lng, lat)
                setPickPopoverOpen(false)
            }

            map.on('click', handleClick)
            requestAnimationFrame(() => {
                map.resize()
            })

            return () => {
                map.off('click', handleClick)
                map.getCanvas().style.cursor = ''
                map.remove()
                pickMapRef.current = null
                pickMarkerRef.current = null
            }
        }

        let cleanup: (() => void) | undefined
        rafId = requestAnimationFrame(() => {
            cleanup = init()
        })

        return () => {
            disposed = true
            if (rafId) cancelAnimationFrame(rafId)
            cleanup?.()
        }
    }, [pickPopoverOpen, mapInitialLongitude, mapInitialLatitude, setMapInitialCenter, mapboxAccessToken])

    const renderPublicSetting = () => (
        <div className="space-y-0">
            <SettingItem title="Public IP" description="Control the Public IP. e.g: http://127.0.0.1:8000">
                <Input
                    value={leadIP ?? DEFAULT_LEAD_IP}
                    className="w-64 bg-gray-700 border-gray-600 text-white"
                    onChange={(e) => setLeadIP(e.target.value)}
                />
            </SettingItem>
            <SettingItem title="Backend API URL" description="Local backend endpoint. Leave blank to use env or the default 8000 server.">
                <div className="w-[360px] space-y-1">
                    <Input
                        value={apiBaseUrlOverride}
                        className="h-7 bg-gray-700 border-gray-600 text-white"
                        onChange={(e) => setApiBaseUrlOverride(e.target.value.trim())}
                        placeholder={DEFAULT_API_BASE_URL}
                        aria-invalid={Boolean(apiBaseUrlError)}
                    />
                    <div className={apiBaseUrlError ? "text-xs text-red-300" : "text-xs text-gray-500"}>
                        {apiBaseUrlError ?? `Using ${effectiveApiBaseUrl} from ${apiBaseUrlSourceLabel}.`}
                    </div>
                </div>
            </SettingItem>
        </div >
    )

    const renderGeneralSetting = () => (
        <div className="space-y-0">
            <SettingItem title="Topology: High Speed" description="Control whether to enable high-speed operations.">
                <Select
                    value={highSpeedMode ? "on" : "off"}
                    onValueChange={(value) => setHighSpeedMode(value === "on")}
                >
                    <SelectTrigger className="w-32 bg-gray-700 border-gray-600">
                        <SelectValue placeholder="Off" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="off">Off</SelectItem>
                        <SelectItem value="on">On</SelectItem>
                    </SelectContent>
                </Select>
            </SettingItem>
        </div>
    )

    const renderMapViewGeneralSetting = () => (
        <div className="space-y-0">
            <SettingItem title="Mapbox Token" description="Public Mapbox token used by Map view and the mini map picker.">
                <div className="w-[360px] space-y-1">
                    <div className="flex items-center gap-1">
                        <Input
                            value={savedMapboxAccessToken}
                            type={showMapboxAccessToken ? "text" : "password"}
                            className="h-7 bg-gray-700 border-gray-600 text-white"
                            onChange={(e) => setMapboxAccessToken(e.target.value.trim())}
                            placeholder={`${mapboxPublicTokenPrefix}...`}
                            aria-invalid={Boolean(mapboxTokenError)}
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-gray-300 hover:bg-gray-700 hover:text-white"
                            onClick={() => setShowMapboxAccessToken((value) => !value)}
                            title={showMapboxAccessToken ? "Hide token" : "Show token"}
                            aria-label={showMapboxAccessToken ? "Hide Mapbox token" : "Show Mapbox token"}
                        >
                            {showMapboxAccessToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                    </div>
                    <div className={mapboxTokenError ? "text-xs text-red-300" : "text-xs text-gray-500"}>
                        {mapboxTokenError ?? "Stored locally in this app. Use only a public pk token."}
                    </div>
                </div>
            </SettingItem>
            <SettingItem title="Map View: Center" description="Set initial map center (WGS84).">
                <div className="flex items-center gap-2">
                    <div className="grid grid-cols-[80px_144px] items-center gap-y-2">
                        <div className="text-xs text-gray-400 text-left">Longitude:</div>
                        <Input
                            value={lngInput}
                            className="w-36 h-6 bg-gray-700 border-gray-600 text-white"
                            onChange={(e) => setLngInput(e.target.value)}
                            onBlur={(e) => commitLng(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') commitLng((e.target as HTMLInputElement).value)
                            }}
                            placeholder="114.051537"
                        />
                        <div className="text-xs text-gray-400 text-left">Latitude:</div>
                        <Input
                            value={latInput}
                            className="w-36 h-6 bg-gray-700 border-gray-600 text-white"
                            onChange={(e) => setLatInput(e.target.value)}
                            onBlur={(e) => commitLat(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') commitLat((e.target as HTMLInputElement).value)
                            }}
                            placeholder="22.446937"
                        />
                    </div>
                    <Popover open={pickPopoverOpen} onOpenChange={setPickPopoverOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="secondary"
                                className="flex flex-col gap-0 bg-blue-500 h-15 w-15 hover:bg-blue-600 text-white cursor-pointer"
                                title="Pick from mini map"
                            >
                                <MapPin className="w-8 h-8" />
                                <span className="text-sm">Pick</span>
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" sideOffset={8} className="w-[400px] p-4">
                            <div className="space-y-2">
                                <div className="text-sm font-semibold">Pick Map Center</div>
                                <div className="text-xs text-gray-400">Click on the mini map to set Longitude/Latitude.</div>
                                {mapboxAccessToken ? (
                                    <div className="w-full h-[360px] rounded-md overflow-hidden border border-gray-300 shadow-md">
                                        <div className="w-full h-[400px] cursor-crosshair hide-mapbox-branding" ref={mapWrapperRef} />
                                    </div>
                                ) : (
                                    <div className="flex h-[160px] items-center justify-center rounded-md border border-gray-300 bg-gray-900 px-4 text-center text-xs leading-5 text-gray-300">
                                        Set <span className="mx-1 font-mono text-gray-100">{mapboxTokenEnvName}</span> in <span className="ml-1 font-mono text-gray-100">client/src/.env</span> to use the mini map.
                                    </div>
                                )}
                                <div className="text-xs text-gray-400">Current: {mapInitialLongitude.toFixed(6)}, {mapInitialLatitude.toFixed(6)}</div>
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
            </SettingItem>
        </div>
    )

    const getSettingContent = () => {
        switch (activeCategory) {
            case "public-tree":
            case "lead-ip":
                return renderPublicSetting()
            case "map-view":
            case "map-view-general":
                return renderMapViewGeneralSetting()
            case "topology-editor":
            case "controlling":
                return renderGeneralSetting()
            default:
                return (
                    <div className="text-center py-12">
                        <p className="text-gray-400">Select a setting category from the left to view related options</p>
                    </div>
                )
        }
    }

    return (
        <div className="flex-1 bg-[#1E1E1E]">
            <div className="px-6 py-4">
                <div className="flex space-x-6">
                    <button className="text-blue-400 border-b-2 border-blue-400 pb-2">User</button>
                    <button className="text-gray-400 hover:text-white pb-2">Workspace</button>
                </div>
            </div>
            <div className="px-6">
                <div className="max-w-4xl">{getSettingContent()}</div>
            </div>
        </div>
    )
}
