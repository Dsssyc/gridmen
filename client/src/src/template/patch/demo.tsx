import {
    SplinePointer,
    Pencil,
    Trash2,
    Undo2,
    Redo2,
    MousePointer,
    Dot,
    Minus,
    Square,
    Globe,
    Palette,
} from "lucide-react"
import {
    Dialog,
    DialogTitle,
    DialogHeader,
    DialogFooter,
    DialogContent,
    DialogDescription,
} from "@/components/ui/dialog"
import {
    Select,
    SelectItem,
    SelectValue,
    SelectContent,
    SelectTrigger,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import type { IResourceNode } from "../scene/iscene"
import type { IViewContext } from "@/views/IViewContext"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { ResourceNode, ResourceTree } from "../scene/scene"
import * as api from '../api/apis'
import { Badge } from "@/components/ui/badge"
import { MapViewContext } from "@/views/mapView/mapView"
import { useLayerGroupStore, useToolPanelStore } from "@/store/storeSet"
import { toast } from "sonner"
import { getHexColorByValue, toValidFeatureCollection, vectorColorMap } from "@/utils/utils"

interface VectorCreationProps {
    node: IResourceNode
    context: IViewContext
}

interface PageContext {
    hasVector: boolean
    drawVector: GeoJSON.FeatureCollection | null
    vectorData: {
        type: "point" | "line" | "polygon" | null
        name: string
        epsg: string
        color: string
    }
    demPath: string
    sessionId: string
    createdFeatureIds: Set<string>
}

interface VectorData {
    type: "point" | "line" | "polygon"
    name: string
    epsg: string
    color: string
}

type ToolType = "select" | "draw" | "move" | "delete";
type CreateVectorTab = "draw" | "upload"

const vectorTips = [
    { tip1: "Fill in the name of the Schema and the EPSG code." },
    { tip2: "Description is optional." },
    { tip3: "Click the button to draw and obtain or manually fill in the coordinates of the reference point." },
    { tip4: "Set the grid size for each level." },
]

export default function VectorCreation({ node, context }: VectorCreationProps) {

    const mapContext = context as MapViewContext
    const map = mapContext.map!
    const drawInstance = mapContext.drawInstance!

    const pageContext = useRef<PageContext>({
        hasVector: false,
        drawVector: null,
        vectorData: {
            type: "point",
            name: "",
            epsg: "4326",
            color: "sky-500",
        },
        demPath: "",
        sessionId: node.nodeInfo,
        createdFeatureIds: new Set(),
    })

    const [typeSelectDialogOpen, setTypeSelectDialogOpen] = useState(true)
    const [pendingType, setPendingType] = useState<VectorData["type"]>("point")
    const [createVectorTab, setCreateVectorTab] = useState<CreateVectorTab>("draw")
    const [uploadFilePath, setUploadFilePath] = useState("")

    const [selectedTool, setSelectedTool] = useState<ToolType>("draw")
    const selectedToolRef = useRef<ToolType>("draw")

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    useEffect(() => {
        loadContext()
        return () => {
            unloadContext()
        }
    }, [])

    const loadContext = async () => {
        setPendingType(pageContext.current.vectorData.type!)

        if ((node as ResourceNode).context !== undefined) {
            pageContext.current = { ...(node as ResourceNode).context }
        } else {
            pageContext.current.vectorData.name = node.name.split('.')[0]
        }

        if (!pageContext.current.vectorData.epsg || !pageContext.current.vectorData.epsg.trim()) {
            pageContext.current.vectorData.epsg = "4326"
        }

        if (pageContext.current.hasVector) {
            setTimeout(() => {
                if (pageContext.current.drawVector && pageContext.current.drawVector.features && pageContext.current.drawVector.features.length > 0) {
                    if (drawInstance) {
                        const loadColor = vectorColorMap.find((item) => item.value === pageContext.current.vectorData.color)?.color ?? "#0ea5e9"
                        for (const feature of pageContext.current.drawVector.features as any[]) {
                            feature.properties = feature.properties || {}
                            feature.properties.user_color = feature.properties.user_color ?? loadColor
                        }
                        const validVectors: GeoJSON.FeatureCollection = toValidFeatureCollection(pageContext.current.drawVector, loadColor)

                        try {
                            drawInstance.add(validVectors)
                            const all = drawInstance.getAll()
                            for (const feature of all.features as any[]) {
                                if (!feature?.id) continue
                                drawInstance.setFeatureProperty(feature.id, "user_color", loadColor)

                                drawInstance.setFeatureProperty(feature.id, "session_id", pageContext.current.sessionId)
                                pageContext.current.createdFeatureIds.add(feature.id)
                            }
                        } catch (error) {
                            console.error("Failed to add vector:", error);
                        }
                    }
                }
            }, 500)
        } else {
            setTypeSelectDialogOpen(true)
        }

        triggerRepaint()
    }

    const unloadContext = () => {
        // const drawInstance = store.get<MapboxDraw>("mapDraw")

        // if (pageContext.current!.hasVector) {
        //     if (drawInstance) {
        //         handleSaveVector()
        //     }
        // }
    }

    const setSelectedToolSafe = useCallback((tool: ToolType) => {
        selectedToolRef.current = tool
        setSelectedTool(tool)
    }, [])

    const safeChangeMode = useCallback((mode: string, modeOptions?: any) => {
        try {
            ; (drawInstance as any)?.changeMode?.(mode, modeOptions)
        } catch (e) {
            console.warn("Failed to change draw mode:", e)
        }
    }, [drawInstance])

    const getDrawModeByType = useCallback((type: VectorData["type"]) => {
        switch (type) {
            case "point":
                return "draw_point"
            case "line":
                return "draw_line_string"
            case "polygon":
                return "draw_polygon"
            default:
                return "simple_select"
        }
    }, [])

    const applyVectorColorToDraw = useCallback((hexColor: string) => {
        if (!drawInstance) return
        const all = drawInstance.getAll()
        for (const feature of all.features) {
            const featureId = (feature as any).id
            if (!featureId) continue
            drawInstance.setFeatureProperty(featureId, "user_color", hexColor)
        }
    }, [drawInstance])

    const syncDrawVectorFromDraw = useCallback(() => {
        if (!drawInstance) return
        const all = drawInstance.getAll()
        pageContext.current.drawVector = all
        pageContext.current.hasVector = all.features.length > 0
        triggerRepaint()
    }, [drawInstance])

    const deleteCurrentSessionFeatures = useCallback(() => {
        if (!drawInstance) return
        try {
            const featureIds = Array.from(pageContext.current.createdFeatureIds)
            if (featureIds.length > 0) {
                drawInstance.delete(featureIds)
                pageContext.current.createdFeatureIds.clear()
            }
        } catch (e) {
            console.warn('Failed to delete current session features:', e)
        }
    }, [drawInstance])

    const getVectorTypeIcon = (type: string) => {
        switch (type) {
            case "point":
                return <Dot className="w-6 h-6 text-blue-500" />
            case "line":
                return <Minus className="w-6 h-6 text-green-500" />
            case "polygon":
                return <Square className="w-6 h-6 text-purple-500" />
            default:
                return null
        }
    }


    useEffect(() => {
        if (!map || !drawInstance) return

        const onCreate = (e: any) => {
            const hex = getHexColorByValue(pageContext.current.vectorData.color)
            if (e?.features && Array.isArray(e.features)) {
                for (const f of e.features) {
                    if (!f?.id) continue
                    drawInstance.setFeatureProperty(f.id, "user_color", hex)
                    drawInstance.setFeatureProperty(f.id, "session_id", pageContext.current.sessionId)

                    pageContext.current.createdFeatureIds.add(f.id)
                }
            }
            syncDrawVectorFromDraw()

            if (selectedToolRef.current === "draw") {
                const mode = getDrawModeByType(pageContext.current.vectorData.type!)
                setTimeout(() => safeChangeMode(mode), 0)
            }
        }

        const onUpdate = (e: any) => {
            const hex = getHexColorByValue(pageContext.current.vectorData.color)
            if (e?.features && Array.isArray(e.features)) {
                for (const f of e.features) {
                    if (!f?.id) continue
                    drawInstance.setFeatureProperty(f.id, "user_color", hex)

                    if (!drawInstance.get(f.id)?.properties?.session_id) {
                        drawInstance.setFeatureProperty(f.id, "session_id", pageContext.current.sessionId)
                        pageContext.current.createdFeatureIds.add(f.id)
                    }
                }
            }
            syncDrawVectorFromDraw()
        }

        const onDelete = (e: any) => {
            if (e?.features && Array.isArray(e.features)) {
                for (const f of e.features) {
                    if (f?.id) {
                        pageContext.current.createdFeatureIds.delete(f.id)
                    }
                }
            }
            syncDrawVectorFromDraw()
        }

        map.on("draw.create", onCreate)
        map.on("draw.update", onUpdate)
        map.on("draw.delete", onDelete)

        return () => {
            map.off("draw.create", onCreate)
            map.off("draw.update", onUpdate)
            map.off("draw.delete", onDelete)
        }
    }, [drawInstance, getDrawModeByType, getHexColorByValue, map, safeChangeMode, syncDrawVectorFromDraw])

    const handleCreateVector = async () => {
        if (!pageContext.current!.vectorData.name.trim() || !pageContext.current!.vectorData.epsg) return

        const newVector = {
            name: pageContext.current!.vectorData.name,
            color: pageContext.current!.vectorData.color,
            epsg: '4326',
        }

        const featureJson = drawInstance.getAll()
        pageContext.current.drawVector = featureJson
        pageContext.current.hasVector = featureJson.features.length > 0

        setSelectedToolSafe('select')
        safeChangeMode('simple_select')
        deleteCurrentSessionFeatures()
        pageContext.current.drawVector = null
        pageContext.current.hasVector = false
        triggerRepaint()

        try {
            await api.node.mountNode({
                nodeInfo: node.nodeInfo,
                templateName: 'vector',
                mountParamsString: JSON.stringify(newVector)
            })

            await api.vector.saveVector(node.nodeInfo, null, featureJson)

            node.isTemp = false
                ; (node as ResourceNode).tree.tempNodeExist = false
                ; (node.tree as ResourceTree).selectedNode = null
                ; (node.tree as ResourceTree).notifyDomUpdate()

            const { isEditMode } = useLayerGroupStore.getState()
            useToolPanelStore.getState().setActiveTab(isEditMode ? 'edit' : 'check')

            await (node.tree as ResourceTree).refresh()
            toast.success('Patch Created successfully')
        } catch (error) {
            try {
                if (featureJson?.features?.length) {
                    drawInstance.add(featureJson)
                    pageContext.current.drawVector = featureJson
                    pageContext.current.hasVector = true
                    triggerRepaint()
                }
            } catch (restoreError) {
                console.warn('Failed to restore vector features after error:', restoreError)
            }
            toast.error(`Failed to create patch: ${error}`)
        }

        triggerRepaint()
    }

    const handleReselectVectorType = () => {
        setCreateVectorTab('draw')
        setUploadFilePath('')
        setTypeSelectDialogOpen(true)
        deleteCurrentSessionFeatures()
        pageContext.current.hasVector = false
        pageContext.current.vectorData = {
            type: "point",
            name: pageContext.current.vectorData.name,
            epsg: pageContext.current.vectorData.epsg,
            color: "sky-500"
        }
        setSelectedTool("draw")
        pageContext.current.sessionId = node.nodeInfo
        pageContext.current.createdFeatureIds.clear()
        triggerRepaint()
    }

    const handleConfirmType = async () => {
        if (createVectorTab === 'draw') {
            pageContext.current.vectorData.type = pendingType
            setTypeSelectDialogOpen(false)
            setSelectedToolSafe("draw")

            const mode = getDrawModeByType(pendingType)
            const hex = getHexColorByValue(pageContext.current.vectorData.color)
            safeChangeMode(mode)
            applyVectorColorToDraw(hex)
        } else if (createVectorTab === 'upload') {
            if (!uploadFilePath || !uploadFilePath.trim()) {
                toast.error("Please select a valid file path")
                return
            }

            const filePath = uploadFilePath.trim()

            const newVector = {
                name: pageContext.current.vectorData.name,
                color: pageContext.current.vectorData.color,
                epsg: null
            }

            try {
                await api.node.mountNode({
                    nodeInfo: node.nodeInfo,
                    templateName: 'vector',
                    mountParamsString: JSON.stringify(newVector)
                })

                await api.vector.saveUploadedVector(node.nodeInfo, null, filePath)

                node.isTemp = false
                    ; (node as ResourceNode).tree.tempNodeExist = false
                    ; (node.tree as ResourceTree).selectedNode = null
                    ; (node.tree as ResourceTree).notifyDomUpdate()

                const { isEditMode } = useLayerGroupStore.getState()
                useToolPanelStore.getState().setActiveTab(isEditMode ? 'edit' : 'check')

                await (node.tree as ResourceTree).refresh()
                toast.success('Patch Created successfully')
            } catch (e) {
                console.error("Failed to mount node for uploaded vector:", e)
                toast.error(`Failed to mount node for uploaded vector: ${e}`)
                return
            }
        }
        pageContext.current.hasVector = true

        triggerRepaint()
    }

    const handleUploadVectorFilePath = async () => {
        try {
            const picked = await window.electronAPI?.openFileDialog?.()
            if (picked) {
                setUploadFilePath(picked)
            }
        } catch (e) {
            console.error("Failed to open file dialog:", e)
        }
    }

    const handleClickDraw = useCallback(() => {
        setSelectedToolSafe("draw")
        const mode = getDrawModeByType(pageContext.current.vectorData.type!)
        safeChangeMode(mode)
    }, [getDrawModeByType, safeChangeMode, setSelectedToolSafe])

    const handleClickSelect = useCallback(() => {
        setSelectedToolSafe("select")
        safeChangeMode("simple_select")
    }, [safeChangeMode, setSelectedToolSafe])

    const handleTypeDialogOpenChange = (open: boolean) => {
        setTypeSelectDialogOpen(open)
        if (!open && !pageContext.current.hasVector) {
            deleteCurrentSessionFeatures()
            pageContext.current.hasVector = false
            pageContext.current.drawVector = null
            triggerRepaint()
        }
    }

    const handleDeleteSelected = useCallback(() => {
        if (selectedToolRef.current !== "select") return
        try {
            ; (drawInstance as any)?.trash?.()
        } catch (e) {
            console.warn("Failed to delete selected features:", e)
        }
        syncDrawVectorFromDraw()
    }, [drawInstance, syncDrawVectorFromDraw])

    useEffect(() => {
        const isEditableTarget = (target: EventTarget | null) => {
            const el = target as HTMLElement | null
            if (!el) return false
            if (el.isContentEditable) return true
            const tag = el.tagName?.toUpperCase()
            return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (typeSelectDialogOpen) return
            if (event.defaultPrevented) return

            if (event.ctrlKey || event.metaKey) {
                if (event.key === "D" || event.key === "d") {
                    event.preventDefault()
                    handleClickDraw()
                    return
                }
                if (event.key === "S" || event.key === "s") {
                    event.preventDefault()
                    handleClickSelect()
                    return
                }
            }

            if (event.key === "Delete") {
                if (isEditableTarget(event.target)) return
                event.preventDefault()
                handleDeleteSelected()
            }
        }

        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [handleClickDraw, handleClickSelect, handleDeleteSelected, typeSelectDialogOpen])

    return (
        <div className="w-full h-full flex flex-col">
            <Dialog open={typeSelectDialogOpen} onOpenChange={handleTypeDialogOpenChange}>
                <DialogContent
                    className="bg-white text-slate-900 border border-slate-200"
                    onInteractOutside={(e) => e.preventDefault()}
                    onEscapeKeyDown={(e) => e.preventDefault()}
                >
                    <DialogHeader>
                        <DialogTitle className="text-slate-900">Choose vector type</DialogTitle>
                        <DialogDescription className="text-slate-600">
                            You’ll enter the editor after confirming.
                        </DialogDescription>
                    </DialogHeader>

                    <Tabs value={createVectorTab} onValueChange={(v) => setCreateVectorTab(v as CreateVectorTab)}>
                        <TabsList className="w-full bg-slate-100 border border-slate-300 rounded-md">
                            <TabsTrigger value="draw" className="cursor-pointer">Draw</TabsTrigger>
                            <TabsTrigger value="upload" className="cursor-pointer">Upload</TabsTrigger>
                        </TabsList>
                        <TabsContent value="draw" className="space-y-2 p-4 border border-slate-300 rounded-md">
                            <Label className="text-sm font-medium text-slate-900">Vector Type:</Label>
                            <RadioGroup
                                value={pendingType}
                                onValueChange={(value: any) => setPendingType(value)}
                                className="space-y-0.5 p-"
                            >
                                <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                                    <RadioGroupItem value="point" id="type-point" className="cursor-pointer" />
                                    <Label htmlFor="type-point" className="flex items-center gap-2 cursor-pointer text-slate-900 flex-1">
                                        <Dot className="w-6 h-6 text-blue-500" />
                                        Point
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                                    <RadioGroupItem value="line" id="type-line" className="cursor-pointer" />
                                    <Label htmlFor="type-line" className="flex items-center gap-2 cursor-pointer text-slate-900 flex-1">
                                        <Minus className="w-6 h-6 text-green-500" />
                                        Line
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                                    <RadioGroupItem value="polygon" id="type-polygon" className="cursor-pointer" />
                                    <Label htmlFor="type-polygon" className="flex items-center gap-2 cursor-pointer text-slate-900 flex-1">
                                        <Square className="w-6 h-6 text-purple-500" />
                                        Polygon
                                    </Label>
                                </div>
                            </RadioGroup>
                            <p className="text-xs text-slate-600">
                                Select a vector type and click Confirm to enter create panel.
                            </p>
                        </TabsContent>

                        <TabsContent value="upload" className="space-y-2 p-4 border border-slate-300 rounded-md">
                            <Label className="text-sm font-medium text-slate-900">Shapefile Path:</Label>
                            <div className="flex items-center gap-2 ">
                                <Input
                                    value={uploadFilePath}
                                    readOnly={true}
                                    placeholder="Select or paste a local file path"
                                    className="w-full h-8 bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
                                />
                                <Button
                                    variant={'default'}
                                    size={'sm'}
                                    className="cursor-pointer"
                                    onClick={handleUploadVectorFilePath}
                                >
                                    Select
                                </Button>
                            </div>
                            {/* TODO: 设置颜色的下拉框 */}
                            <div className="flex flex-col items-center gap-2">
                                <div className="text-sm w-full font-medium text-slate-900">
                                    Vector Color:
                                </div>
                                <Select
                                    value={pageContext.current.vectorData.color}
                                    onValueChange={(value: any) => {
                                        pageContext.current.vectorData.color = value
                                        applyVectorColorToDraw(getHexColorByValue(value))
                                        triggerRepaint()
                                    }}
                                >
                                    <SelectTrigger className="w-full h-8 cursor-pointer bg-white border-slate-300 text-slate-900">
                                        <SelectValue placeholder="Select color" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white border-slate-200">
                                        {vectorColorMap.map((item) => (
                                            <SelectItem
                                                key={item.value}
                                                value={item.value}
                                                className="cursor-pointer text-slate-900 hover:bg-slate-100"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className="w-4 h-4 rounded-full border border-slate-300"
                                                        style={{ backgroundColor: item.color }}
                                                    />
                                                    <span>{item.name}</span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <p className="text-xs text-slate-600">
                                Click Select to pick a file and set its color.
                            </p>
                        </TabsContent>
                    </Tabs>
                    <DialogFooter>
                        <Button type="button" className="bg-blue-500 hover:bg-blue-600 text-white cursor-pointer" onClick={handleConfirmType}>
                            Confirm
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <div className='flex-none w-full border-b border-gray-700 flex flex-col'>
                <div className="w-full flex justify-center items-center gap-4 p-4">
                    <Avatar className="h-10 w-10 border-2 border-white">
                        <AvatarFallback className="bg-[#007ACC]">
                            <SplinePointer className="h-6 w-6 text-white" />
                        </AvatarFallback>
                    </Avatar >
                    <h1 className="font-bold text-[25px] relative flex items-center text-white">
                        Create New Vector
                        <span className="bg-[#D63F26] rounded px-0.5 mb-2 text-[12px] inline-flex items-center mx-1">
                            WorkSpace
                        </span>
                    </h1>
                </div >

                <div className="w-full p-4 pb-2 space-y-2 -mt-2 text-white">
                    <div className="text-sm px-4">
                        <ul className="list-disc space-y-1">
                            {vectorTips.map((tip, index) => (
                                <li key={index}>{Object.values(tip)[0]}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div >
            {pageContext.current.hasVector ? (
                <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
                    <div className="border-b border-gray-700">
                        <div className="w-full p-4 space-y-4 border-t border-gray-700">
                            <div>
                                <h3 className="text-white font-semibold mb-2">Drawing Mode</h3>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={handleClickDraw}
                                        className={`${selectedTool === "draw"
                                            ? "bg-orange-500 hover:bg-orange-600"
                                            : "bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600"}
                                                text-white px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all cursor-pointer`}
                                    >
                                        <Pencil className="h-4 w-4" />
                                        <span>Draw</span>
                                        <span className="text-xs opacity-80">[ Ctrl+D ]</span>
                                    </button>
                                    <button
                                        onClick={handleClickSelect}
                                        className={`${selectedTool === "select"
                                            ? "bg-orange-500 hover:bg-orange-600"
                                            : "bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600"}
                                                text-white px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all cursor-pointer`}
                                    >
                                        <MousePointer className="h-4 w-4" />
                                        <span>Select</span>
                                        <span className="text-xs opacity-80">[ Ctrl+S ]</span>
                                    </button>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-white font-semibold mb-2">Operations</h3>
                                <div className="grid grid-cols-3 gap-2">
                                    <button className="bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600 text-white px-2 py-1 rounded-lg font-medium flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer">
                                        <Undo2 className="h-4 w-4" />
                                        <span>Undo</span>
                                        <span className="text-xs opacity-80">[ Ctrl+Z ]</span>
                                    </button>
                                    <button className="bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600 text-white px-2 py-1 rounded-lg font-medium flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer">
                                        <Redo2 className="h-4 w-4" />
                                        <span>Redo</span>
                                        <span className="text-xs opacity-80">[ Ctrl+Y ]</span>
                                    </button>
                                    <button
                                        onClick={handleDeleteSelected}
                                        disabled={selectedTool !== "select"}
                                        className={`${selectedTool === "select"
                                            ? "bg-red-500 hover:bg-red-600 cursor-pointer"
                                            : "bg-slate-700/50 border border-slate-600 opacity-50 cursor-not-allowed"}
                                                text-white px-2 py-1 rounded-lg font-medium flex flex-col items-center justify-center gap-0.5 transition-all`}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        <span>Delete</span>
                                        <span className="text-xs opacity-80">[ Del ]</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 space-y-2">
                        <div className="space-y-1">
                            <h3 className="text-white font-semibold text-lg flex items-center gap-2">
                                <Palette className="w-5 h-5" />
                                Vector Basic Information
                            </h3>
                            <p className="text-slate-400 text-sm">Configure the properties for your new vector</p>
                        </div>
                        <div className="border-slate-200 border bg-white p-4 rounded-lg shadow-sm">
                            <div className="space-y-2">
                                <div className="space-y-2">
                                    <Label htmlFor="vectorName" className="text-sm font-medium text-slate-900">
                                        Vector Name
                                        <span className="text-red-500 ml-1">*</span>
                                    </Label>
                                    <Input
                                        id="vectorName"
                                        value={pageContext.current.vectorData.name}
                                        readOnly={true}
                                        className="w-full bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="vectorEpsg" className="text-sm font-medium text-slate-900 flex items-center gap-2">
                                        <Globe className="w-4 h-4" />
                                        EPSG Code
                                        <span className="text-red-500 ml-1">*</span>
                                    </Label>
                                    <Input
                                        id="vectorEpsg"
                                        value={pageContext.current.vectorData.epsg}
                                        onChange={(e) => {
                                            pageContext.current.vectorData.epsg = e.target.value
                                            triggerRepaint()
                                        }}
                                        placeholder="e.g., EPSG:4326"
                                        className="w-full bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="vectorColor" className="text-sm font-medium text-slate-900">
                                        Vector Color
                                    </Label>
                                    <Select
                                        value={pageContext.current.vectorData.color}
                                        onValueChange={(value: any) => {
                                            pageContext.current.vectorData.color = value
                                            triggerRepaint()
                                        }}
                                    >
                                        <SelectTrigger className="w-full h-8 cursor-pointer bg-white border-slate-300 text-slate-900">
                                            <SelectValue placeholder="Select color" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white border-slate-200">
                                            {vectorColorMap.map((item) => (
                                                <SelectItem
                                                    key={item.value}
                                                    value={item.value}
                                                    className="cursor-pointer text-slate-900 hover:bg-slate-100"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <div
                                                            className="w-4 h-4 rounded-full border border-slate-300"
                                                            style={{ backgroundColor: item.color }}
                                                        />
                                                        <span>{item.name}</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2 pt-4">
                                    <Label className="text-sm font-medium text-slate-900">Preview</Label>
                                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-slate-500">Type</span>
                                            <div className="flex items-center gap-2">
                                                {getVectorTypeIcon(pageContext.current.vectorData.type!)}
                                                <Badge variant="secondary" className="text-xs font-semibold">
                                                    {pageContext.current.vectorData.type}
                                                </Badge>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-slate-500">Name</span>
                                            <span className="text-slate-900 font-medium">{pageContext.current.vectorData.name || "Not set"}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-slate-500">EPSG</span>
                                            <span className="text-slate-900 font-medium">{pageContext.current.vectorData.epsg || "Not set"}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-slate-500">Color</span>
                                            <div
                                                className="w-20 h-6 rounded-full border-2 border-slate-300 shadow-sm"
                                                style={{
                                                    backgroundColor: vectorColorMap.find((item) => item.value === pageContext.current.vectorData.color)
                                                        ?.color,
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="text-sm w-full flex flex-row items-center justify-center space-x-4">
                            {/* <Button
                                className="w-[1/2] bg-sky-500 hover:bg-sky-600 text-white cursor-pointer"
                                onClick={() => setReselectConfirmOpen(true)}
                            >
                                Reselect Vector Type
                            </Button> */}
                            <Button
                                className="w-full bg-green-500 hover:bg-green-600 text-white cursor-pointer"
                                disabled={!pageContext.current.vectorData.name.trim() || !pageContext.current.vectorData.epsg.trim()}
                                onClick={handleCreateVector}
                            >
                                Create New Vector
                            </Button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
                    <div className="py-2 px-4 w-full space-y-2">
                        <Button
                            className="w-full bg-sky-500 hover:bg-sky-600 text-white cursor-pointer"
                            onClick={handleReselectVectorType}
                        >
                            Select Vector Type
                        </Button>

                        <div className="space-y-1">
                            <h3 className="text-white font-semibold text-lg flex items-center gap-2">
                                <Palette className="w-5 h-5" />
                                Vector Basic Information
                            </h3>
                            <p className="text-slate-400 text-sm">Configure the properties for your new vector</p>
                        </div>
                    </div>
                </div>
            )}

            {/* <AlertDialog open={reselectConfirmOpen} onOpenChange={setReselectConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Reselect vector type?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will clear the current drawing and reset some vector settings. Continue?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirmReselectVectorType}
                            className="bg-sky-600 hover:bg-sky-500 cursor-pointer"
                        >
                            Confirm
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog> */}
        </div >
    )
}
