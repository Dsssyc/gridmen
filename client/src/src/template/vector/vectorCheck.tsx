import React, { useEffect, useReducer, useRef } from 'react'
import { IResourceNode } from '../scene/iscene'
import { IViewContext } from '@/views/IViewContext'
import { MapViewContext } from '@/views/mapView/mapView'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Dot, Globe, Minus, Palette, SplinePointer, Square, X } from 'lucide-react'
import { ResourceNode } from '../scene/scene'
import { linkNode } from '../api/node'
import * as api from '../api/apis'
import { getHexColorByValue, vectorColorMap } from '@/utils/utils'
import store from '@/store/store'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { addVectorDisplay, tagVectorColor, VectorDisplayHandle } from '@/views/mapView/vectorDisplayLayer'
import { layerOrderCoordinator } from '@/views/mapView/layerOrderCoordinator'

interface VectorCheckProps {
    node: IResourceNode
    context: IViewContext
}

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

const vectorTips = [
    { tip1: "Fill in the name of the Schema and the EPSG code." },
    { tip2: "Description is optional." },
    { tip3: "Click the button to draw and obtain or manually fill in the coordinates of the reference point." },
    { tip4: "Set the grid size for each level." },
]

const getVectorTypeIcon = (type: string) => {
    switch (type) {
        case "point":
            return <Dot className="w-6 h-6 text-blue-500" />
        case "line":
            return <Minus className="w-6 h-6 text-green-500" />
        case "polygon":
            return <Square className="w-6 h-6 text-purple-500" />
    }
}

export default function VectorCheck({ node, context }: VectorCheckProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map!
    const drawInstance = mapContext.drawInstance!

    const pageContext = useRef<PageContext>({
        drawVector: null,
        vectorData: {
            type: "polygon",
            name: "",
            epsg: "4326",
            color: "sky-500",
        },
        checkedVectorIds: new Set<string>(),
        displayHandle: null,
    })

    const [, triggerRepaint] = useReducer((x) => x + 1, 0)

    useEffect(() => {
        loadContext()
        return () => {
            unloadContext()
        }
    }, [])

    const loadContext = async () => {
        if (!(node as ResourceNode).lockId) {
            store.get<{ on: Function, off: Function }>('isLoading')!.on()
            const linkResponse = await linkNode("gridmen/IVector/1.0.0", node.nodeInfo, "w");
            (node as ResourceNode).lockId = linkResponse.lock_id
            store.get<{ on: Function, off: Function }>('isLoading')!.off()
        }

        if ((node as ResourceNode).mountParams === undefined) {
            const vectorInfo = await api.vector.getVector(node.nodeInfo, (node as ResourceNode).lockId!);
            (node as ResourceNode).mountParams = vectorInfo.data
        }

        pageContext.current.vectorData.epsg = (node as ResourceNode).mountParams.epsg
        pageContext.current.vectorData.color = (node as ResourceNode).mountParams.color
        pageContext.current.vectorData.type = (node as ResourceNode).mountParams.feature_json?.features[0]?.geometry.type
        pageContext.current.vectorData.name = (node as ResourceNode).mountParams.name
        pageContext.current.drawVector = (node as ResourceNode).mountParams.feature_json

        const hex = getHexColorByValue(pageContext.current.vectorData.color)
        // Display via per-vector mapbox layers so panel z-order applies
        const fcCopy: GeoJSON.FeatureCollection = JSON.parse(JSON.stringify(pageContext.current.drawVector!))
        tagVectorColor(fcCopy, hex)
        const handle = addVectorDisplay(map, node.nodeInfo, fcCopy)
        pageContext.current.displayHandle = handle
        layerOrderCoordinator.register(node.nodeInfo, handle.mapboxLayerIds)

        (node as ResourceNode).context = {
            ...((node as ResourceNode).context ?? {}),
            __cleanup: {
                ...(((node as ResourceNode).context as any)?.__cleanup ?? {}),
                vectorCheck: () => {
                    pageContext.current.displayHandle?.remove()
                    pageContext.current.displayHandle = null
                    pageContext.current.checkedVectorIds.clear()
                    layerOrderCoordinator.unregister(node.nodeInfo)
                }
            },
        }

        triggerRepaint()
    }

    const unloadContext = () => {
        if (drawInstance) {
            (drawInstance as any).changeMode('simple_select');
        }

        (node as ResourceNode).context = {
            ...pageContext.current,
            __cleanup: {
                ...(((node as ResourceNode).context as any)?.__cleanup ?? {}),
                vectorCheck: () => {
                    pageContext.current.displayHandle?.remove()
                    pageContext.current.displayHandle = null
                    pageContext.current.checkedVectorIds.clear()
                    layerOrderCoordinator.unregister(node.nodeInfo)
                }
            },
        }
    }

    return (
        <div className="w-full h-full flex flex-col">
            <>
                <div className='flex-none w-full border-b border-gray-700 flex flex-col'>
                    <div className="w-full flex justify-center items-center gap-4 p-4">
                        <Avatar className="h-10 w-10 border-2 border-white">
                            <AvatarFallback className="bg-[#007ACC]">
                                <SplinePointer className="h-6 w-6 text-white" />
                            </AvatarFallback>
                        </Avatar>
                        <h1 className="font-bold text-[25px] relative flex items-center text-white">
                            Check Vector
                            <span className="bg-[#D63F26] rounded px-0.5 mb-2 text-[12px] inline-flex items-center mx-1">
                                WorkSpace
                            </span>
                        </h1>
                    </div>

                    <div className="w-full p-4 pb-2 space-y-2 -mt-2 text-white">
                        <div className="text-sm px-4">
                            <ul className="list-disc space-y-1">
                                {vectorTips.map((tip, index) => (
                                    <li key={index}>{Object.values(tip)[0]}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
                    <div className="px-4 py-2 space-y-2">
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
                                        disabled={true}
                                    >
                                        <SelectTrigger className="w-full cursor-pointer bg-white border-slate-300 text-slate-900">
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
                                                {getVectorTypeIcon(pageContext.current.vectorData.type)}
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
                    </div>
                </div>
            </>
        </div>
    )
}
