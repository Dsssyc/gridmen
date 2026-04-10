import { useEffect, useReducer, useRef, useState } from "react"
import { toast } from 'sonner'
import * as api from '../api/apis'
import {
    AlertDialog,
    AlertDialogTitle,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogContent,
    AlertDialogDescription,
} from '@/components/ui/alert-dialog'
import { Badge } from "@/components/ui/badge"
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IResourceNode } from '../scene/iscene'
import { IViewContext } from '@/views/IViewContext'
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { MapViewContext } from '@/views/mapView/mapView'
import { ResourceNode, ResourceTree } from '../scene/scene'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useLayerGroupStore, useToolPanelStore } from "@/store/storeSet"
import { addMapPatchBounds, clearMapPatchBounds, cn, convertBoundsCoordinates } from '@/utils/utils'
import { Fullscreen, GripVertical, MapPin, RotateCcw, Square, SquaresUnite, Upload, X } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import store from "@/store/store"

interface GridCreationProps {
    node: IResourceNode
    context: IViewContext
}

type VectorOps = "set" | "add" | "subtract" | "max"

const operationColorMap: Record<VectorOps, string> = {
    set: "bg-blue-200",
    add: "bg-green-200",
    subtract: "bg-red-200",
    max: "bg-orange-200",
}

const demOpsList: Array<{ value: VectorOps; label: string; className: string }> = [
    { value: "set", label: "Set", className: "bg-blue-200" },
    { value: "add", label: "Add", className: "bg-green-200" },
    { value: "subtract", label: "Subtract", className: "bg-red-200" },
    { value: "max", label: "Max", className: "bg-orange-200" },
]

interface PatchMapInfo {
    nodeInfo: string
    nodeLockId: string | null
    originBounds: [number, number, number, number]
    boundsOn4326: [number, number, number, number]
    schemaNodeKey: string
}

interface SelectedVectorItem {
    nodeInfo: string
    vectorInfo: Record<string, any>

    demEnabled: boolean
    demType: VectorOps
    demValue: number | null

    lumEnabled: boolean
    lumValue: number | null
}

interface PageContext {
    name: string
    demFilePath: string | null
    lumFilePath: string | null
    patchMap: Map<string, PatchMapInfo[]>
    selectedVectors: SelectedVectorItem[]
}

const gridTips = [
    { tip1: "Drag patches from the EXPLORER to the upload area." },
    { tip2: "Reset button will clear all uploaded patches." },
    { tip3: "Click merge button to complete grid creation." },
]

const schemaBorderColorClasses = [
    "border-sky-500",
    "border-emerald-500",
    "border-amber-500",
    "border-fuchsia-500",
    "border-rose-500",
    "border-indigo-500",
]

const schemaBorderHexColors: Record<string, string> = {
    "border-sky-500": "#0ea5e9",
    "border-emerald-500": "#10b981",
    "border-amber-500": "#f59e0b",
    "border-fuchsia-500": "#d946ef",
    "border-rose-500": "#f43f5e",
    "border-indigo-500": "#6366f1",
    "border-slate-200": "#e2e8f0",
}

const vectorColorMap = [
    { value: "sky-500", color: "#0ea5e9" },
    { value: "green-500", color: "#22c55e" },
    { value: "red-500", color: "#ef4444" },
    { value: "purple-500", color: "#a855f7" },
    { value: "yellow-300", color: "#FFDF20" },
    { value: "orange-500", color: "#FF6900" },
    { value: "pink-500", color: "#ec4899" },
    { value: "indigo-500", color: "#6366f1" },
]

const getAllPatches = (patchMap: Map<string, PatchMapInfo[]>): PatchMapInfo[] => {
    return Array.from(patchMap.values()).flat()
}

export default function GridCreation({ node, context }: GridCreationProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map!

    const pageContext = useRef<PageContext>({
        name: "",
        demFilePath: "",
        lumFilePath: "",
        patchMap: new Map<string, PatchMapInfo[]>(),
        selectedVectors: [],
    })

    const [isPatchDragOver, setIsPatchDragOver] = useState(false)
    const [isVectorDragOver, setIsVectorDragOver] = useState(false)
    const [assemblyDialogOpen, setAssemblyDialogOpen] = useState(false)

    const [, triggerRepaint] = useReducer((x) => x + 1, 0)

    const demRawInputs = useRef<Map<string, string>>(new Map())

    useEffect(() => {
        loadContext()

        return () => {
            unloadContext()
        }
    }, [])

    const loadContext = () => {
        if ((node as ResourceNode).context !== undefined) {
            pageContext.current = { ...(node as ResourceNode).context }
        } else {
            pageContext.current.name = node.name.split('.')[0]
        }

        (node as ResourceNode).context = {
            ...((node as ResourceNode).context ?? {}),
            __cleanup: {
                ...(((node as ResourceNode).context as any)?.__cleanup ?? {}),
                gridCreation: () => {
                    handlePatchReset()
                    handleVectorReset()
                },
            },
        }

        triggerRepaint()
    }

    const unloadContext = () => {
        (node as ResourceNode).context = {
            ...pageContext.current,
            __cleanup: {
                ...(((node as ResourceNode).context as any)?.__cleanup ?? {}),
                gridCreation: () => {
                    handlePatchReset()
                    handleVectorReset()
                },
            },
        }

        return
    }

    const openRasterFileDialog = async () => {
        if (!window.electronAPI) {
            toast.error("Electron API not available")
            return null
        }

        const api = window.electronAPI
        const picker =
            typeof api.openTiffFileDialog === "function"
                ? api.openTiffFileDialog
                : typeof api.openFileDialog === "function"
                    ? api.openFileDialog
                    : null

        if (!picker) {
            toast.error("Electron API not available")
            return null
        }

        try {
            return await picker()
        } catch (error) {
            console.error("Error opening file dialog:", error)
            toast.error("Failed to open file dialog")
            return null
        }
    }

    const handleSelectDemFile = async () => {
        const filePath = await openRasterFileDialog()
        if (!filePath) return
        pageContext.current.demFilePath = filePath
        triggerRepaint()
    }

    const handleSelectLumFile = async () => {
        const filePath = await openRasterFileDialog()
        if (!filePath) return
        pageContext.current.lumFilePath = filePath
        triggerRepaint()
    }

    const handlePatchDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsPatchDragOver(true)
    }

    const handlePatchDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsPatchDragOver(false)
    }

    const handlePatchDropZoneDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        setIsPatchDragOver(false)

        const raw = e.dataTransfer.getData("application/gridmen-node") || e.dataTransfer.getData("text/plain")
        const payload = JSON.parse(raw) as {
            nodeKey: string
            nodeInfo: string
            nodeLockId: string | null
            templateName: string
            sourceTreeTitle: string
        }

        if (!payload?.nodeKey || payload.templateName !== "patch") {
            toast.error("Please drag a patch resource")
            return
        }

        const allPatches = getAllPatches(pageContext.current.patchMap)
        const exists = allPatches.some((p) => p.nodeInfo === payload.nodeInfo)
        if (exists) {
            toast.info("This patch is already in the list")
            return
        }

        const patchResponse = await api.patch.getPatchMeta(payload.nodeInfo, payload.nodeLockId)

        const schemaNodeKey = patchResponse.schema_node_key
        const boundsOn4326 = await convertBoundsCoordinates(patchResponse.bounds, patchResponse.epsg, 4326,) as [number, number, number, number]

        const patchInfo: PatchMapInfo = {
            nodeInfo: payload.nodeInfo,
            nodeLockId: payload.nodeLockId,
            originBounds: patchResponse.bounds,
            boundsOn4326: boundsOn4326,
            schemaNodeKey: schemaNodeKey,
        }

        const existing = pageContext.current.patchMap.get(schemaNodeKey)
        if (Array.isArray(existing)) {
            existing.push(patchInfo)
        } else {
            pageContext.current.patchMap.set(schemaNodeKey, [patchInfo])
        }

        const patchOriginBounds = patchResponse.bounds
        const patchConvertedBounds = (await convertBoundsCoordinates(patchOriginBounds, patchResponse.epsg, 4326,)) as [number, number, number, number]
        const schemaHex = pickSchemaHexColor(schemaNodeKey)

        addMapPatchBounds(map, patchConvertedBounds, payload.nodeInfo, false, {
            lineColor: schemaHex,
            fillColor: schemaHex,
            opacity: 0.12,
            lineWidth: 3,
        })

        triggerRepaint()
    }

    const handleVectorDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsVectorDragOver(true)
    }

    const handleVectorDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsVectorDragOver(false)
    }

    const handleVectorDragStart = (index: number) => (e: React.DragEvent) => {
        e.dataTransfer.setData("application/gridmen-vector-reorder", JSON.stringify({ fromIndex: index }))
        e.dataTransfer.effectAllowed = "move"
    }

    const handleVectorItemDrop = (index: number) => (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()

        const raw = e.dataTransfer.getData("application/gridmen-vector-reorder")
        const payload = JSON.parse(raw)

        const fromIndex = payload?.fromIndex
        const list = pageContext.current.selectedVectors

        const [moved] = list.splice(fromIndex, 1)
        list.splice(index, 0, moved)

        triggerRepaint()
    }

    const getHexColorByValue = (value: string) => {
        if (!value) return "#0ea5e9"
        return vectorColorMap.find((item) => item.value === value)?.color ?? "#0ea5e9"
    }

    const pickSchemaHexColor = (schemaNodeKey: string) => {
        const borderClass = pickSchemaBorderClass(schemaNodeKey)
        return schemaBorderHexColors[borderClass] ?? "#0ea5e9"
    }

    const pickSchemaBorderClass = (schemaNodeInfo: string) => {
        const key = schemaNodeInfo.trim()

        let hash = 0
        for (let i = 0; i < key.length; i++) {
            hash = (hash * 31 + key.charCodeAt(i)) >>> 0
        }

        return schemaBorderColorClasses[hash % schemaBorderColorClasses.length]
    }

    const handlePatchRemove = (patchNodeInfo: string) => {
        let targetSchemaKey: string | null = null
        let targetPatchIndex: number = -1

        for (const [schemaKey, patches] of pageContext.current.patchMap.entries()) {
            const patchIndex = patches.findIndex(p => p.nodeInfo === patchNodeInfo)
            if (patchIndex !== -1) {
                targetSchemaKey = schemaKey
                targetPatchIndex = patchIndex
                break
            }
        }

        if (targetSchemaKey && targetPatchIndex !== -1) {
            const patches = pageContext.current.patchMap.get(targetSchemaKey)!
            patches.splice(targetPatchIndex, 1)

            if (patches.length === 0) {
                pageContext.current.patchMap.delete(targetSchemaKey)
            }

            clearMapPatchBounds(map, patchNodeInfo)
            triggerRepaint()
        }
    }

    const handleVectorDropZoneDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        setIsVectorDragOver(false)

        const raw = e.dataTransfer.getData("application/gridmen-node") || e.dataTransfer.getData("text/plain")
        const payload = JSON.parse(raw) as {
            nodeKey: string
            nodeInfo: string
            nodeLockId: string | null
            templateName: string
            sourceTreeTitle: string
        }

        if (!payload?.nodeKey || payload.templateName !== "vector") {
            toast.error("Please drag a vector resource")
            return
        }

        const exists = pageContext.current.selectedVectors.some((v) => v.nodeInfo === payload.nodeInfo)
        if (exists) {
            toast.info("This vector is already in the list")
            return
        }

        const vectorResponse = await api.vector.getVector(payload.nodeInfo, payload.nodeLockId)

        const featureJson = vectorResponse.data.feature_json as GeoJSON.FeatureCollection
        const nodeInfo = payload.nodeInfo

        const sourceId = `grid-vector-src-${nodeInfo}`
        const fillLayerId = `grid-vector-fill-${nodeInfo}`
        const lineLayerId = `grid-vector-line-${nodeInfo}`
        const pointLayerId = `grid-vector-point-${nodeInfo}`

        const hex = getHexColorByValue(String(vectorResponse.data?.color ?? "sky-500"))

        const apply = () => {
            const src = map.getSource(sourceId) as any
            if (src?.setData) {
                src.setData(featureJson)
            } else {
                if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
                if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
                if (map.getLayer(pointLayerId)) map.removeLayer(pointLayerId)
                if (map.getSource(sourceId)) map.removeSource(sourceId)

                map.addSource(sourceId, {
                    type: "geojson",
                    data: featureJson,
                })
            }

            if (!map.getLayer(fillLayerId)) {
                map.addLayer({
                    id: fillLayerId,
                    type: "fill",
                    source: sourceId,
                    filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
                    paint: {
                        "fill-color": ["coalesce", ["get", "user_color"], hex],
                        "fill-opacity": 0.25,
                    },
                })
            }

            if (!map.getLayer(lineLayerId)) {
                map.addLayer({
                    id: lineLayerId,
                    type: "line",
                    source: sourceId,
                    filter: [
                        "any",
                        ["==", ["geometry-type"], "Polygon"],
                        ["==", ["geometry-type"], "MultiPolygon"],
                        ["==", ["geometry-type"], "LineString"],
                        ["==", ["geometry-type"], "MultiLineString"],
                    ],
                    paint: {
                        "line-color": ["coalesce", ["get", "user_color"], hex],
                        "line-width": 2,
                    },
                })
            }

            if (!map.getLayer(pointLayerId)) {
                map.addLayer({
                    id: pointLayerId,
                    type: "circle",
                    source: sourceId,
                    filter: ["any", ["==", ["geometry-type"], "Point"], ["==", ["geometry-type"], "MultiPoint"]],
                    paint: {
                        "circle-color": ["coalesce", ["get", "user_color"], hex],
                        "circle-radius": 6,
                        "circle-stroke-color": "#ffffff",
                        "circle-stroke-width": 1,
                    },
                })
            }
        }

        apply()

        pageContext.current.selectedVectors.push({
            nodeInfo: payload.nodeInfo,
            vectorInfo: vectorResponse.data,

            demEnabled: false,
            demType: "set",
            demValue: null,

            lumEnabled: false,
            lumValue: null,
        })

        triggerRepaint()
    }

    const handlePatchReset = () => {
        const patchNodeInfos = getAllPatches(pageContext.current.patchMap).map((patch) => patch.nodeInfo)
        patchNodeInfos.map(nodeInfo => clearMapPatchBounds(map, nodeInfo))

        pageContext.current.patchMap = new Map<string, PatchMapInfo[]>()

        triggerRepaint()
    }

    const removeVectorFromMap = (nodeInfo: string) => {
        const sourceId = `grid-vector-src-${nodeInfo}`
        const fillLayerId = `grid-vector-fill-${nodeInfo}`
        const lineLayerId = `grid-vector-line-${nodeInfo}`
        const pointLayerId = `grid-vector-point-${nodeInfo}`

        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(pointLayerId)) map.removeLayer(pointLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
    }

    const handleVectorRemove = (index: number) => {
        const item = pageContext.current.selectedVectors[index]
        removeVectorFromMap(item.nodeInfo)

        pageContext.current.selectedVectors = pageContext.current.selectedVectors.filter((_, i) => i !== index)

        triggerRepaint()
    }

    const handleVectorReset = () => {
        for (const v of pageContext.current.selectedVectors) {
            removeVectorFromMap(v.nodeInfo)
        }
        pageContext.current.selectedVectors = []
        triggerRepaint()
    }

    const handlePreviewGridBounds = () => {
        const patches = getAllPatches(pageContext.current.patchMap)

        let minX = Number.POSITIVE_INFINITY
        let minY = Number.POSITIVE_INFINITY
        let maxX = Number.NEGATIVE_INFINITY
        let maxY = Number.NEGATIVE_INFINITY

        for (const patch of patches) {
            const [x1, y1, x2, y2] = patch.boundsOn4326
            if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) continue
            minX = Math.min(minX, x1)
            minY = Math.min(minY, y1)
            maxX = Math.max(maxX, x2)
            maxY = Math.max(maxY, y2)
        }

        map.fitBounds([[minX, minY], [maxX, maxY],], {
            padding: 100,
            duration: 1000,
        },)

    }

    const handleAssemblyClick = () => {
        if (pageContext.current.patchMap.size > 1) {
            toast.error("Please delete patches with different schemas before creating the grid")
            return
        } else if (pageContext.current.patchMap.size === 1) {
            setAssemblyDialogOpen(true)
        }
    }

    const handleConfirmAssembly = async () => {
        const patchNodeInfos = getAllPatches(pageContext.current.patchMap).map((patch) => patch.nodeInfo)
        const schemaNodeKey = Array.from(pageContext.current.patchMap.keys())[0]

        const vectorData = pageContext.current.selectedVectors.map((v) => {
            const item: any = { node_key: v.nodeInfo }

            if (v.demEnabled) {
                item.dem = {
                    type: v.demType,
                    value: v.demValue,
                }
            }

            if (v.lumEnabled) {
                item.lum = {
                    type: "set",
                    value: v.lumValue,
                }
            }

            return item
        })

        const gridData = {
            assembly: {
                schema_node_key: schemaNodeKey,
                patch_node_keys: patchNodeInfos,
                dem_path: pageContext.current.demFilePath,
                lum_path: pageContext.current.lumFilePath,
            },
            vector: vectorData,
        }

        try {
            store.get<{ on: Function, off: Function }>('isLoading')!.on()
            await api.node.mountNode({
                nodeInfo: node.nodeInfo,
                templateName: 'grid',
                mountParamsString: JSON.stringify(gridData),
            })

            handlePatchReset()
            handleVectorReset()

            node.isTemp = false
                ; (node as ResourceNode).tree.tempNodeExist = false
                ; (node.tree as ResourceTree).selectedNode = null
                ; (node.tree as ResourceTree).notifyDomUpdate()

            const { isEditMode } = useLayerGroupStore.getState()
            useToolPanelStore.getState().setActiveTab(isEditMode ? 'edit' : 'check')


            await (node.tree as ResourceTree).refresh()
            toast.success('Patch Created successfully')
        } catch (error) {
            toast.error('Failed to create grid: ' + (error as Error).message)
            return
        } finally {
            store.get<{ on: Function, off: Function }>('isLoading')!.off()
        }
    }

    return (
        <div className="w-full h-full flex flex-col">
            <div className="flex-none w-full border-b border-gray-700 flex flex-col">
                {/* ------------*/}
                {/* Page Avatar */}
                {/* ------------*/}
                <div className="w-full flex justify-center items-center gap-4 p-4">
                    <Avatar className="h-10 w-10 border-2 border-white">
                        <AvatarFallback className="bg-[#007ACC]">
                            <SquaresUnite className="h-6 w-6 text-white" />
                        </AvatarFallback>
                    </Avatar>
                    <h1 className="font-bold text-[25px] relative flex items-center">
                        Create New Grid
                        <span className="bg-[#D63F26] rounded px-0.5 mb-2 text-[12px] inline-flex items-center mx-1">
                            WorkSpace
                        </span>
                    </h1>
                </div>
                {/* -----------------*/}
                {/* Page Description */}
                {/* -----------------*/}
                <div className="w-full p-4 pb-2 space-y-2 -mt-2 text-white">
                    {/* ----------*/}
                    {/* Page Tips */}
                    {/* ----------*/}
                    <div className="text-sm px-4">
                        <ul className="list-disc space-y-1">
                            {gridTips.map((tip, index) => (
                                <li key={index}>{Object.values(tip)[0]}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
                <div className="w-full mx-auto space-y-2 px-6 pt-2 pb-4">
                    {/* ----------- */}
                    {/* Grid Name */}
                    {/* ----------- */}
                    <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
                        <h2 className="text-lg text-black font-semibold mb-2">New Grid Name</h2>
                        <div className="space-y-2">
                            <Input
                                id="name"
                                value={pageContext.current.name}
                                readOnly={true}
                                className={`w-full text-black border-gray-300`}
                            />
                        </div>
                    </div>
                    <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
                        <h2 className="text-lg text-black font-semibold">Raster Resource Upload</h2>
                        <div className="space-y-1 flex flex-col">
                            {/* DEM */}
                            <div className="flex flex-col p-2 space-y-0.5">
                                <div className="text-black font-semibold">DEM File</div>
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0">
                                        <Input
                                            value={pageContext.current.demFilePath || ""}
                                            readOnly={true}
                                            placeholder="Select DEM file"
                                            className="h-8 w-full min-w-0 rounded-sm text-base text-black border-slate-300"
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="cursor-pointer gap-1 shrink-0"
                                        onClick={handleSelectDemFile}
                                    >
                                        <Upload className="w-4 h-4" />
                                        Upload
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="cursor-pointer text-red-500 shrink-0"
                                        onClick={() => {
                                            pageContext.current.demFilePath = ""
                                            triggerRepaint()
                                        }}
                                        disabled={!pageContext.current.demFilePath}
                                    >
                                        <X className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                            <Separator className="bg-slate-200 w-full" />
                            {/* LUM */}
                            <div className="flex flex-col p-2 space-y-0.5">
                                <div className="text-black font-semibold">LUM File</div>
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0">
                                        <Input
                                            value={pageContext.current.lumFilePath || ""}
                                            readOnly={true}
                                            placeholder="Select LUM file"
                                            className="h-8 w-full min-w-0 rounded-sm text-base text-black border-slate-300"
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="cursor-pointer gap-1 shrink-0"
                                        onClick={handleSelectLumFile}
                                    >
                                        <Upload className="w-4 h-4" />
                                        Upload
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="cursor-pointer text-red-500 shrink-0"
                                        onClick={() => {
                                            pageContext.current.lumFilePath = ""
                                            triggerRepaint()
                                        }}
                                        disabled={!pageContext.current.lumFilePath}
                                    >
                                        <X className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* ----------- */}
                    {/* Patch Drop Zone */}
                    {/* ----------- */}
                    <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
                        <h2 className="text-lg text-black font-semibold mb-2">Patch Drop Zone</h2>
                        <div>
                            <div
                                className={cn(
                                    "border-2 border-dashed rounded-lg p-4 transition-all duration-200",
                                    isPatchDragOver
                                        ? "border-blue-400 bg-blue-50"
                                        : "border-slate-300 bg-slate-50 hover:bg-slate-100",
                                )}
                                onDragOver={handlePatchDragOver}
                                onDragLeave={handlePatchDragLeave}
                                onDrop={handlePatchDropZoneDrop}
                            >
                                {getAllPatches(pageContext.current.patchMap).length === 0 ? (
                                    <div className="h-[30vh] flex flex-col justify-center items-center text-slate-400">
                                        <Upload className="w-8 h-8 mb-2" />
                                        <p className="text-sm font-medium mb-1">Drag patches here</p>
                                        <p className="text-xs text-center">Drop patches from the EXPLORER</p>
                                        <p className="text-md font-semibold text-center">With same schema</p>
                                    </div>
                                ) : (
                                    <div className="h-[30vh] overflow-y-auto scrollbar-hide pr-1">
                                        <div className="space-y-1">
                                            {getAllPatches(pageContext.current.patchMap).map((patch) => {
                                                return (
                                                    <div
                                                        key={patch.nodeInfo}
                                                        className={cn(
                                                            "bg-white rounded-lg p-3 flex flex-col gap-1.5 hover:shadow-sm transition-all duration-200",
                                                            `border-2 ${pickSchemaBorderClass(patch.schemaNodeKey)}`
                                                        )}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex-1 flex items-center gap-2 min-w-0">
                                                                <Square className="h-6 w-6 text-sky-500" />
                                                                <p className="text-slate-900 text-md font-medium truncate">{patch.nodeInfo.split(".").pop() || "Patch"}</p>
                                                                <span>{patch.nodeInfo}</span>
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    className="ml-2 h-6 w-6 p-0 text-sky-500 hover:text-sky-600 cursor-pointer"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        map.fitBounds(patch.boundsOn4326, {
                                                                            padding: 200,
                                                                            duration: 1000
                                                                        })
                                                                    }}
                                                                >
                                                                    <MapPin className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    className="h-6 w-6 p-0 text-red-500 hover:text-red-600 cursor-pointer"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        handlePatchRemove(patch.nodeInfo)
                                                                    }}
                                                                >
                                                                    <X className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center text-xs text-gray-500 truncate">
                                                            <span>belong to schema: </span>
                                                            <span className="font-semibold">{patch.schemaNodeKey}</span>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                                <span>{getAllPatches(pageContext.current.patchMap).length || 0} patches uploaded</span>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    className="bg-red-500 hover:bg-red-600 text-white hover:text-white cursor-pointer shadow-sm"
                                    onClick={handlePatchReset}
                                    disabled={getAllPatches(pageContext.current.patchMap).length === 0}
                                >
                                    <RotateCcw className="w-4 h-4" />Reset
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* ----------- */}
                    {/* Vector Drop Zone */}
                    {/* ----------- */}
                    <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
                        <h2 className="text-lg text-black font-semibold mb-2">Vector Drop Zone</h2>
                        <div>
                            <div
                                className={cn(
                                    "border-2 border-dashed rounded-lg p-4 transition-all duration-200",
                                    isVectorDragOver
                                        ? "border-purple-500 bg-purple-50"
                                        : "border-slate-300 bg-slate-50 hover:bg-slate-100",
                                )}
                                onDragOver={handleVectorDragOver}
                                onDragLeave={handleVectorDragLeave}
                                onDrop={handleVectorDropZoneDrop}
                            >
                                {pageContext.current.selectedVectors.length === 0 ? (
                                    <div className="h-[30vh] flex flex-col justify-center items-center text-slate-400">
                                        <Upload className="w-8 h-8 mb-2" />
                                        <p className="text-sm font-medium mb-1">Drag vectors here</p>
                                        <p className="text-xs text-center">Drop patches from the EXPLORER</p>
                                    </div>
                                ) : (
                                    <div className="h-[30vh] overflow-y-auto scrollbar-hide pr-1">
                                        <div className="space-y-1">
                                            {pageContext.current.selectedVectors.map((item, index) => {
                                                const showDemValue =
                                                    item.demEnabled &&
                                                    (item.demType === "set" || item.demType === "add" || item.demType === "subtract")

                                                const demOpMeta =
                                                    demOpsList.find((opt) => opt.value === item.demType) ??
                                                    demOpsList.find((opt) => opt.value === 'set') ??
                                                    demOpsList[0]

                                                return (
                                                    <div
                                                        key={item.nodeInfo}
                                                        draggable
                                                        onDragStart={handleVectorDragStart(index)}
                                                        onDragOver={(e) => { e.preventDefault() }}
                                                        onDrop={handleVectorItemDrop(index)}
                                                        className={cn("bg-white border border-slate-200 rounded-lg p-2 flex flex-col gap-1 hover:shadow-sm transition-all duration-200 cursor-move")}
                                                    >
                                                        <div className="flex items-start justify-between gap-1">
                                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                                <div className="w-8 h-8 rounded-md bg-purple-500 flex items-center justify-center flex-shrink-0 cursor-grab active:cursor-grabbing">
                                                                    <GripVertical className="h-4 w-4 text-white" />
                                                                </div>
                                                                <div className="min-w-0 flex-1">
                                                                    <p className="text-slate-900 text-sm font-medium truncate mb-0.5">{item.nodeInfo.split(".").pop()}</p>
                                                                    <p className="text-xs text-slate-500 truncate font-mono bg-slate-50 px-2 py-0.5 rounded inline-block">
                                                                        {item.nodeInfo}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="ml-2 h-6 w-6 p-0 text-red-500 cursor-pointer"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    handleVectorRemove(index)
                                                                }}
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                        <div className="grid grid-cols-1 gap-0.5">
                                                            {/* DEM */}
                                                            <div className="flex items-center bg-slate-50 rounded-sm p-2 border border-slate-200">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <Checkbox
                                                                        className="cursor-pointer"
                                                                        checked={item.demEnabled}
                                                                        onCheckedChange={(checked) => {
                                                                            item.demEnabled = Boolean(checked)
                                                                            if (item.demEnabled && !item.demType) item.demType = "set"
                                                                            if (!item.demEnabled) item.demValue = null
                                                                            triggerRepaint()
                                                                        }}
                                                                    />
                                                                    <div className="flex items-center gap-1">
                                                                        <span className="text-sm text-slate-800 leading-none">DEM</span>
                                                                        <DropdownMenu>
                                                                            <DropdownMenuTrigger asChild>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                    disabled={!item.demEnabled}
                                                                                    className={cn(
                                                                                        "cursor-pointer flex items-center",
                                                                                        !item.demEnabled && "cursor-not-allowed opacity-50",
                                                                                    )}
                                                                                >
                                                                                    <Badge
                                                                                        variant="outline"
                                                                                        className={cn(
                                                                                            "select-none font-medium",
                                                                                            demOpMeta.className,
                                                                                        )}
                                                                                    >
                                                                                        {demOpMeta.label}
                                                                                    </Badge>
                                                                                </button>
                                                                            </DropdownMenuTrigger>
                                                                            <DropdownMenuContent align="start">
                                                                                <DropdownMenuRadioGroup
                                                                                    value={item.demType}
                                                                                    onValueChange={(value) => {
                                                                                        item.demType = value as VectorOps
                                                                                        triggerRepaint()
                                                                                    }}
                                                                                >
                                                                                    {demOpsList.map((opt) => (
                                                                                        <DropdownMenuRadioItem key={opt.value} value={opt.value} className="cursor-pointer">
                                                                                            {opt.label}
                                                                                        </DropdownMenuRadioItem>
                                                                                    ))}
                                                                                </DropdownMenuRadioGroup>
                                                                            </DropdownMenuContent>
                                                                        </DropdownMenu>
                                                                        <Input
                                                                            value={demRawInputs.current.get(item.nodeInfo) ?? (item.demValue ?? "")}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            onChange={(e) => {
                                                                                const raw = e.target.value
                                                                                demRawInputs.current.set(item.nodeInfo, raw)
                                                                                if (raw.trim() === "" || raw.trim() === "-") {
                                                                                    item.demValue = null
                                                                                } else {
                                                                                    const n = Number(raw)

                                                                                    // If the input is an invalid number, add error and empty value
                                                                                    if (isNaN(n) || !Number.isFinite(n)) {
                                                                                        toast.error("Please enter a valid number for DEM value")
                                                                                        item.demValue = null
                                                                                        triggerRepaint()
                                                                                    } else {
                                                                                        item.demValue = Number.isFinite(n) ? n : item.demValue
                                                                                    }


                                                                                }
                                                                                triggerRepaint()
                                                                            }}
                                                                            disabled={!showDemValue}
                                                                            placeholder={showDemValue ? "Enter value" : "-"}
                                                                            className="w-full h-6 rounded-sm text-base text-black border-slate-300 focus:border-purple-400"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* LUM */}
                                                            <div className="flex items-center bg-slate-50 rounded-sm p-2 border border-slate-200">
                                                                <div className="flex items-center gap-2 min-w-0 w-full">
                                                                    <Checkbox
                                                                        className="cursor-pointer"
                                                                        checked={item.lumEnabled}
                                                                        onCheckedChange={(checked) => {
                                                                            item.lumEnabled = Boolean(checked)
                                                                            if (!item.lumEnabled) item.lumValue = null
                                                                            triggerRepaint()
                                                                        }}
                                                                    />
                                                                    <div className="flex items-center gap-1 min-w-0 w-full">
                                                                        <span className="text-sm text-slate-800 leading-none">LUM</span>
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            disabled={!item.lumEnabled}
                                                                            className={cn("flex items-center", !item.lumEnabled && "cursor-not-allowed opacity-50")}
                                                                        >
                                                                            <Badge
                                                                                variant="outline"
                                                                                className={cn("select-none font-medium", operationColorMap.set)}
                                                                            >
                                                                                Set
                                                                            </Badge>
                                                                        </button>

                                                                        <Input
                                                                            value={item.lumValue ?? ""}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            onChange={(e) => {
                                                                                const raw = e.target.value
                                                                                if (raw.trim() === "") {
                                                                                    item.lumValue = null
                                                                                } else {
                                                                                    const n = Number(raw)
                                                                                    item.lumValue = Number.isFinite(n) ? n : null
                                                                                }
                                                                                triggerRepaint()
                                                                            }}
                                                                            disabled={!item.lumEnabled}
                                                                            placeholder={item.lumEnabled ? "Enter value" : "-"}
                                                                            className="w-full h-6 rounded-sm text-base text-black border-slate-300 focus:border-purple-400"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                                <span>{pageContext.current.selectedVectors.length || 0} vectors uploaded</span>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    className="bg-red-500 hover:bg-red-600 text-white hover:text-white cursor-pointer shadow-sm"
                                    onClick={handleVectorReset}
                                    disabled={pageContext.current.selectedVectors.length === 0}
                                >
                                    <RotateCcw className="w-4 h-4" />Reset
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* ----------- */}
                    {/* Action Buttons */}
                    {/* ----------- */}
                    <div className="flex gap-2 justify-end">
                        <Button
                            variant="default"
                            className="bg-blue-500 hover:bg-blue-600 text-white hover:text-white cursor-pointer shadow-sm"
                            onClick={handlePreviewGridBounds}
                            disabled={getAllPatches(pageContext.current.patchMap).length === 0}
                        >
                            <Fullscreen className="w-4 h-4 " />
                            <span>Preview</span>
                        </Button>
                        <Button
                            type="button"
                            onClick={handleAssemblyClick}
                            className="bg-green-500 hover:bg-green-600 text-white cursor-pointer"
                            disabled={getAllPatches(pageContext.current.patchMap).length === 0}
                        >
                            <SquaresUnite className="w-4 h-4 " />
                            Assembly
                        </Button>
                    </div>
                </div>
            </div>
            <AlertDialog open={assemblyDialogOpen} onOpenChange={setAssemblyDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Merge Patches</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div>
                                <div className="mb-4">
                                    You will merge {getAllPatches(pageContext.current.patchMap).length} patches to create gird{" "}
                                    <span className="font-bold">[{pageContext.current.name}]</span>
                                </div>
                                <div className="max-h-[200px] overflow-y-auto scrollbar-hide bg-gray-100 p-3 rounded-lg">
                                    <ul className="list-disc list-inside space-y-1">
                                        {getAllPatches(pageContext.current.patchMap).map((patch) => (
                                            <li key={patch.nodeInfo} className="text-sm">
                                                {(patch.nodeInfo.split(".").pop() || "Patch")} <span className="text-gray-500 text-xs">({patch.nodeInfo})</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmAssembly} className="bg-green-600 hover:bg-green-500 cursor-pointer">
                            Confirm
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
