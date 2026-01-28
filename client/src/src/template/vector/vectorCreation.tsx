import React, { useEffect, useReducer, useRef, useState } from 'react'
import { IResourceNode } from '../scene/iscene'
import { IViewContext } from '@/views/IViewContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Dot, Minus, SplinePointer, Square } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { vectorColorMap } from '@/utils/utils'
import { ResourceNode } from '../scene/scene'

interface VectorCreationProps {
    node: IResourceNode
    context: IViewContext
}

interface PageContext {
    hasVector: boolean
    drawVector: GeoJSON.FeatureCollection | null
    vectorData: {
        type: "point" | "line" | "polygon"
        name: string
        epsg: string
        color: string
    }
    demFilePath: string | null
    sessionId: string | null
    createdVectorIds: Set<string>
}

const vectorTips = [
    { tip1: "Fill in the name of the Schema and the EPSG code." },
    { tip2: "Description is optional." },
    { tip3: "Click the button to draw and obtain or manually fill in the coordinates of the reference point." },
    { tip4: "Set the grid size for each level." },
]

export default function VectorCreation({ node, context }: VectorCreationProps) {
    const pageContext = useRef<PageContext>({
        hasVector: false,
        drawVector: null,
        vectorData: {
            type: "point",
            name: "",
            epsg: "4326",
            color: "sky-500"

        },
        demFilePath: null,
        sessionId: null,
        createdVectorIds: new Set<string>(),
    })

    const [createVectorTab, setCreateVectorTab] = useState<"draw" | "upload">("draw")
    const [pendingType, setPendingType] = useState<"point" | "line" | "polygon">("point")
    const [, triggerRepaint] = useReducer(x => x + 1, 0)

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
            pageContext.current.vectorData.name = node.name.split('.')[0]
        }

        triggerRepaint()
    }

    const unloadContext = () => {

        return
    }

    return (
        <div className="w-full h-full flex flex-col">
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
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
                    <div className='w-full mx-auto space-y-2 px-6 pt-2 pb-4'>
                        <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                            <h2 className='text-black text-lg font-semibold mb-2'>
                                New Vector Name
                            </h2>
                            <div className='space-y-2'>
                                <Input
                                    id='name'
                                    value={pageContext.current.vectorData.name}
                                    readOnly={true}
                                    className="w-full text-black border-gray-300"
                                />
                            </div>
                        </div>
                        <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200 space-y-1'>
                            <h2 className='text-black text-lg font-semibold'>
                                Choose vector type
                            </h2>
                            {createVectorTab === "draw" ? (
                                <p className='text-black '>You’ll enter the editor after confirming.</p>
                            ) : (
                                <p className='text-black '>You’ll create this vector directly after confirming.</p>
                            )}
                            <Tabs value={createVectorTab} onValueChange={(v) => setCreateVectorTab(v as "draw" | "upload")}>
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
                                        Select a vector type to draw.
                                    </p>
                                </TabsContent>

                                <TabsContent value="upload" className="space-y-2 p-4 border border-slate-300 rounded-md">
                                    <Label className="text-sm font-medium text-slate-900">Shapefile Path:</Label>
                                    <div className="flex items-center gap-2 ">
                                        <Input
                                            value={pageContext.current.demFilePath || ''}
                                            readOnly={true}
                                            placeholder="Select or paste a local file path"
                                            className="w-full h-8 bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
                                        />
                                        <Button
                                            variant={'default'}
                                            size={'sm'}
                                            className="cursor-pointer"
                                        // onClick={handleUploadVectorFilePath}
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
                                                // applyVectorColorToDraw(getHexColorByValue(value))
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
                        </div>
                        <div className='mt-4'>
                            <Button
                                type="button"
                                // onClick={handleConfirmType}
                                className={`w-full ${createVectorTab === "draw" ? "bg-blue-500 hover:bg-blue-600" : "bg-green-500 hover:bg-green-600"} text-white cursor-pointer`}
                            >
                                <span>Confirm</span>
                                {createVectorTab === "draw" ? (
                                    <span>Type Select</span>
                                ) : (
                                    <span>Create Vector</span>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    )
}
