import { useEffect, useReducer, useRef, useState } from 'react'
import { toast } from 'sonner'
import * as api from '../api/apis'
import { PatchData } from './types'
import { SchemaData } from '../schema/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IResourceNode } from '../scene/iscene'
import { IViewContext } from '@/views/IViewContext'
import { useToolPanelStore } from '@/store/storeSet'
import { Separator } from '@/components/ui/separator'
import { useLayerGroupStore } from '@/store/storeSet'
import { MapViewContext } from '@/views/mapView/mapView'
import { ResourceNode, ResourceTree } from '../scene/scene'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ArrowRightLeft, MapPin, Save, SquaresIntersect, Upload, X } from 'lucide-react'
import { addMapMarker, addMapPatchBounds, adjustPatchBounds, clearMapPatchBounds, clearMarkerByNodeKey, convertBoundsCoordinates, convertPointCoordinate, startDrawRectangle, stopDrawRectangle } from '@/utils/utils'

interface PatchCreationProps {
    node: IResourceNode
    context: IViewContext
}

export interface Schema extends SchemaData {
    schemaNodeKey: string
}

interface PageContext {
    name: string
    schema: Schema | null
    originBounds: [number, number, number, number] | null
    convertedBounds: [number, number, number, number] | null
    adjustedBounds: [number, number, number, number] | null
    inputBounds: [number, number, number, number] | null
    hasBounds: boolean
    AlignmentOriginOn4326: [number, number] | null
}

interface RectangleCoordinates {
    northEast: [number, number];
    southEast: [number, number];
    southWest: [number, number];
    northWest: [number, number];
    center: [number, number];
}

interface FormErrors {
    name: boolean
    bounds: boolean
}

interface ValidationResult {
    isValid: boolean
    errors: FormErrors
    generalError: string | null
}

const patchTips = [
    { tip1: 'Fill in the name of the Schema and the EPSG code.' },
    { tip2: 'Description is optional.' },
    { tip3: 'Click the button to draw and obtain or manually fill in the coordinates of the reference point.' },
    { tip4: 'Set the grid size for each level.' },
]

const validatePatchForm = (
    name: string,
    bounds: [number, number, number, number]
): ValidationResult => {
    const errors = {
        name: false,
        bounds: false
    }

    let generalError: string | null = null

    if (!name.trim()) {
        errors.name = true
        generalError = 'Please enter patch name'
        return { isValid: false, errors, generalError }
    }

    if (!bounds) {
        errors.bounds = true
        generalError = 'Please draw patch bounds'
        return { isValid: false, errors, generalError }
    } else {
        if (bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
            errors.bounds = true
            generalError = 'Please draw patch bounds correctly'
            return { isValid: false, errors, generalError }
        }
    }
    return { isValid: true, errors, generalError }
}

export default function PatchCreation({ node, context }: PatchCreationProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map!
    const drawInstance = mapContext.drawInstance!

    const pageContext = useRef<PageContext>({
        name: '',
        schema: null,
        originBounds: null,
        convertedBounds: null,
        adjustedBounds: null,
        inputBounds: null,
        hasBounds: false,
        AlignmentOriginOn4326: null,
    })

    const [isDrawingBounds, setIsDrawingBounds] = useState(false)
    const [generalMessage, setGeneralMessage] = useState<string | null>(null)

    const [formErrors, setFormErrors] = useState<{
        name: boolean
        bounds: boolean
    }>({
        name: false,
        bounds: false,
    })

    const tempSchemaKeyRef = useRef<string | null>(null)

    let bgColor = 'bg-red-50'
    let textColor = 'text-red-700'
    let borderColor = 'border-red-200'
    if (generalMessage?.includes('Submitting data')) {
        bgColor = 'bg-orange-50'
        textColor = 'text-orange-700'
        borderColor = 'border-orange-200'
    }
    else if (generalMessage?.includes('Created successfully')) {
        bgColor = 'bg-green-50'
        textColor = 'text-green-700'
        borderColor = 'border-green-200'
    }

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    useEffect(() => {
        loadContext()

        return () => {
            unloadContext()
        }
    }, [])

    const loadContext = async () => {
        if ((node as ResourceNode).context !== undefined) {
            pageContext.current = { ...(node as ResourceNode).context }
            if (pageContext.current.schema) {
                pageContext.current.AlignmentOriginOn4326 = await convertPointCoordinate(pageContext.current.schema!.alignment_origin, pageContext.current.schema!.epsg, 4326)
            }
        } else {
            pageContext.current.name = node.name.split('.')[0]
        }

        (node as ResourceNode).context = {
            ...((node as ResourceNode).context ?? {}),
            __cleanup: {
                ...(((node as ResourceNode).context as any)?.__cleanup ?? {}),
                patchCreation: () => {
                    clearMarkerByNodeKey(pageContext.current.schema!.schemaNodeKey)
                    clearMapPatchBounds(map, node.key)
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
                patchCreation: () => {
                    clearMarkerByNodeKey(pageContext.current.schema!.schemaNodeKey)
                    clearMapPatchBounds(map, node.key)
                },
            },
        }

        return
    }

    const adjustCoords = async () => {
        if (pageContext.current.originBounds && pageContext.current.originBounds.length === 4 && pageContext.current.schema) {
            const bounds = pageContext.current.originBounds
            const gridLevel = pageContext.current.schema.grid_info[0]
            const fromEPSG = 4326
            const toEPSG = pageContext.current.schema.epsg
            const alignmentOrigin = pageContext.current.schema.alignment_origin

            const { convertedBounds, alignedBounds, expandedBounds } = await adjustPatchBounds(bounds, gridLevel, fromEPSG, toEPSG, alignmentOrigin)

            pageContext.current.convertedBounds = convertedBounds
            pageContext.current.adjustedBounds = expandedBounds

            triggerRepaint()
        }
    }
    const formatSingleValue = (value: number): string => value.toFixed(6)

    const handleSchemaNodeDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.currentTarget.classList.add('border-blue-500', 'bg-blue-50')
    }
    const handleSchemaNodeDragLeave = (e: React.DragEvent) => {
        e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50')
    }
    const handleSchemaNodeDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50')
        const raw = e.dataTransfer.getData('application/gridmen-node') || e.dataTransfer.getData('text/plain')

        const payload = JSON.parse(raw) as {
            nodeKey: string
            nodeInfo: string
            templateName: string
            sourceTreeTitle: string
        }

        const { nodeInfo: dragNodeInfo, nodeKey: dragNodeKey, templateName, sourceTreeTitle } = payload

        if (!dragNodeKey || templateName !== 'schema') {
            toast.error('Please drag a schema node')
            return
        } else {
            const { mount_params } = await (api.node.getNodeParams(dragNodeInfo) as any)
            const schemaMountParams = JSON.parse(mount_params) as SchemaData
            const schema: Schema = {
                ...schemaMountParams,
                schemaNodeKey: dragNodeKey
            }

            clearMarkerByNodeKey(tempSchemaKeyRef.current!)
            pageContext.current.AlignmentOriginOn4326 = await convertPointCoordinate(schema.alignment_origin, schema.epsg, 4326)
            addMapMarker(map, pageContext.current.AlignmentOriginOn4326!, schema.schemaNodeKey)
            tempSchemaKeyRef.current = schema.schemaNodeKey

            pageContext.current.schema = schema
        }
        triggerRepaint()
    }

    const handleDrawBounds = () => {
        if (pageContext.current.schema === null) {
            toast.info('Please select a schema first')
            return
        }
        if (isDrawingBounds) {
            setIsDrawingBounds(false)
            stopDrawRectangle(map, drawInstance)
            document.removeEventListener('rectangle-draw-complete', onDrawComplete)
            return
        } else {
            setIsDrawingBounds(true)
            startDrawRectangle(map, drawInstance)
            document.addEventListener('rectangle-draw-complete', onDrawComplete)
        }
    }

    const onDrawComplete = async (event: Event) => {
        const customEvent = event as CustomEvent<{ coordinates: RectangleCoordinates | null }>
        if (customEvent.detail.coordinates) {
            pageContext.current.originBounds = [customEvent.detail.coordinates.southWest[0], customEvent.detail.coordinates.southWest[1], customEvent.detail.coordinates.northEast[0], customEvent.detail.coordinates.northEast[1]]
            await adjustCoords()
            pageContext.current.inputBounds = pageContext.current.convertedBounds
            addMapPatchBounds(map, [customEvent.detail.coordinates.southWest[0], customEvent.detail.coordinates.southWest[1], customEvent.detail.coordinates.northEast[0], customEvent.detail.coordinates.northEast[1]], node.key, false)
        }
        document.removeEventListener('rectangle-draw-complete', onDrawComplete)
        setIsDrawingBounds(false)
        stopDrawRectangle(map, drawInstance)

        triggerRepaint()
    }

    // TODO: 添加patch创建的调整边界和对齐点连线
    /////////////////////////////////////////////////////
    const clearDrawPatchBounds = () => {
        console.log('clearDrawPatchBounds')
    }

    const clearGridLines = () => {
        console.log('clearGridLines')
    }
    /////////////////////////////////////////////////////

    const handleSetInputBounds = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
        if (!pageContext.current.inputBounds) {
            pageContext.current.inputBounds = [0, 0, 0, 0]
        }
        const value = parseFloat(e.target.value) || 0
        pageContext.current.inputBounds[index] = value
        pageContext.current.hasBounds = false
        triggerRepaint()
    }

    const drawBoundsByParams = async () => {
        if (pageContext.current.hasBounds) {
            toast.info('Map bounds have been adjusted')
            return
        }

        if (pageContext.current.schema === null) {
            toast.info('Please select a schema first')
            return
        }

        if (pageContext.current.inputBounds && pageContext.current.inputBounds.length === 4 && pageContext.current.schema) {

            const inputBoundsOn4326 = await convertBoundsCoordinates(pageContext.current.inputBounds!, pageContext.current.schema.epsg, 4326)

            if (!inputBoundsOn4326) {
                toast.error('Failed to convert bounds to EPSG:4326')
                return
            }

            pageContext.current.originBounds = inputBoundsOn4326
            addMapPatchBounds(map, inputBoundsOn4326, node.key)

            await adjustCoords()

        }
    }

    const formatCoordinate = (coord: [number, number] | undefined) => {
        if (!coord) return '---'
        return `[${coord[0].toFixed(6)}, ${coord[1].toFixed(6)}]`
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        const validation = validatePatchForm(pageContext.current.name!, pageContext.current.adjustedBounds!)

        if (!validation.isValid) {
            setFormErrors(validation.errors)
            setGeneralMessage(validation.generalError)
            return
        }

        const patchData: PatchData = {
            name: pageContext.current.name,
            bounds: pageContext.current.adjustedBounds!,
            schema_node_key: pageContext.current.schema!.schemaNodeKey
        }

        setGeneralMessage('Submitting data...')

        try {
            await api.node.mountNode({
                nodeInfo: node.nodeInfo,
                templateName: 'patch',
                mountParamsString: JSON.stringify(patchData)
            })

            clearMarkerByNodeKey(pageContext.current.schema!.schemaNodeKey)
            clearMapPatchBounds(map, node.key)

            node.isTemp = false
                ; (node as ResourceNode).tree.tempNodeExist = false
                ; (node.tree as ResourceTree).selectedNode = null
                ; (node.tree as ResourceTree).notifyDomUpdate()

            const { isEditMode } = useLayerGroupStore.getState()
            useToolPanelStore.getState().setActiveTab(isEditMode ? 'edit' : 'check')

            setGeneralMessage('Created successfully')
            await (node.tree as ResourceTree).refresh()
            toast.success('Patch Created successfully')
        } catch (error) {
            setGeneralMessage(`Failed to create patch: ${error}`)
            toast.error(`Failed to create patch: ${error}`)
        }
    }

    const deleteDragSchema = () => {
        clearMarkerByNodeKey(pageContext.current.schema!.schemaNodeKey)
        tempSchemaKeyRef.current = null
        pageContext.current.schema = null

        triggerRepaint()
    }

    return (
        <div className='w-full h-full flex flex-col'>
            <div className='flex-none w-full border-b border-gray-700 flex flex-col'>
                {/* ------------*/}
                {/* Page Avatar */}
                {/* ------------*/}
                <div className='w-full flex justify-center items-center gap-4 p-4'>
                    <Avatar className='h-10 w-10 border-2 border-white'>
                        <AvatarFallback className='bg-[#007ACC]'>
                            <SquaresIntersect className='h-6 w-6 text-white' />
                        </AvatarFallback>
                    </Avatar>
                    <h1 className='font-bold text-[25px] relative flex items-center'>
                        Create New Patch
                        <span className=" bg-[#D63F26] rounded px-0.5 mb-2 text-[12px] inline-flex items-center mx-1">WorkSpace</span>
                    </h1>
                </div>
                {/* -----------------*/}
                {/* Page Description */}
                {/* -----------------*/}
                <div className='w-full p-4 pb-2 space-y-2 -mt-2 text-white'>
                    {/* ----------*/}
                    {/* Page Tips */}
                    {/* ----------*/}
                    <div className='text-sm px-4'>
                        <ul className='list-disc space-y-1'>
                            {patchTips.map((tip, index) => (
                                <li key={index}>
                                    {Object.values(tip)[0]}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
            <div className='flex-1 overflow-y-auto min-h-0 scrollbar-hide'>
                <div className='w-full mx-auto space-y-2 px-6 pt-2 pb-4'>
                    {/* ----------- */}
                    {/* Patch Name */}
                    {/* ----------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                        <h2 className='text-black text-lg font-semibold mb-2'>
                            New Patch Name
                        </h2>
                        <div className='space-y-2'>
                            <Input
                                id='name'
                                value={pageContext.current.name}
                                readOnly={true}
                                className={`w-full text-black border-gray-300 ${formErrors.name ? 'border-red-500 focus:ring-red-500' : ''}`}
                            />
                        </div>
                    </div>
                    {/* --------- */}
                    {/* Belong To Schema */}
                    {/* --------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                        <h2 className='text-black text-lg font-semibold mb-2'>
                            Belong To Schema
                        </h2>
                        <div className='space-y-2'>
                            <div
                                onDragOver={handleSchemaNodeDragOver}
                                onDragLeave={handleSchemaNodeDragLeave}
                                onDrop={handleSchemaNodeDrop}
                                className='border-2 border-dashed border-gray-300 rounded-lg p-4 text-center transition-all duration-200 hover:border-blue-400 hover:bg-blue-50/50 group'
                            >
                                {pageContext.current.schema ? (
                                    <div className='space-y-2'>
                                        <div className='inline-flex items-center gap-2 px-6 py-1.5 bg-red-50 border-2 border-red-300 rounded-md shadow-md transition-all duration-200 group-hover:shadow-md group-hover:border-red-500'>
                                            <MapPin className='w-4 h-4 text-red-400 hover:text-red-600 cursor-pointer' fill='none' stroke='currentColor' viewBox='0 0 24 24' onClick={() => {
                                                map.flyTo({
                                                    center: pageContext.current.AlignmentOriginOn4326 ?? [0, 0],
                                                    zoom: 15,
                                                    duration: 1000,
                                                })
                                            }} />
                                            <span className='font-semibold text-black text-md'>{pageContext.current.schema.name}</span>
                                            <X className='w-4 h-4 text-gray-400 cursor-pointer hover:text-gray-800' onClick={deleteDragSchema} />
                                        </div>
                                        <div className='flex items-center justify-center gap-2 text-sm text-gray-500'>
                                            <ArrowRightLeft className='w-4 h-4' />
                                            <span >Drag to change schema</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className='space-y-2 py-1'>
                                        <div className='inline-flex items-center justify-center w-12 h-12 bg-gray-100 rounded-full mb-2 group-hover:bg-blue-100 transition-colors'>
                                            <Upload className='w-6 h-6 text-gray-400 group-hover:text-blue-500 transition-colors' />
                                        </div>
                                        <div className='font-medium text-gray-500 text-sm'>Drag a schema here</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    {/* --------- */}
                    {/* EPSG Code */}
                    {/* --------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                        <h2 className='text-black text-lg font-semibold mb-2'>
                            Schema EPSG Code
                        </h2>
                        <div className='space-y-2'>
                            <Input
                                id='epsg'
                                placeholder={'Get EPSG Code From Schema'}
                                className='text-black w-full border-gray-300 '
                                value={pageContext.current.schema?.epsg ?? ''}
                                readOnly={true}
                            />
                        </div>
                    </div>
                    {/* --------- */}
                    {/* Patch Bounds */}
                    {/* --------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                        <h2 className='text-black text-lg font-semibold mb-2'>
                            Patch Bounds
                        </h2>
                        <div className='space-y-2'>
                            <div className='p-2 bg-white rounded-md shadow-sm border border-gray-200'>
                                <div className='text-black font-semibold text-sm mb-2'>
                                    Method One: Draw to generate
                                </div>
                                <button
                                    type='button'
                                    onClick={handleDrawBounds}
                                    className={`w-full py-2 px-4 rounded-md font-medium transition-colors cursor-pointer ${isDrawingBounds
                                        ? 'bg-red-500 text-white hover:bg-red-600'
                                        : 'bg-blue-500 text-white hover:bg-blue-600'}`}
                                >
                                    {isDrawingBounds
                                        ? 'Click to cancel rectangle drawing'
                                        : 'Click to draw rectangle'}
                                </button>
                                {isDrawingBounds && (
                                    <div className='mt-2 p-2 bg-yellow-50 rounded-md border border-yellow-200 text-xs text-yellow-800'>
                                        <p>Drawing method:</p>
                                        <ul className='list-disc pl-4 mt-1'>
                                            <li>
                                                Click on the map to set starting point
                                            </li>
                                            <li>
                                                Move the mouse to desired location
                                            </li>
                                            <li>
                                                Click again to complete drawing
                                            </li>
                                        </ul>
                                    </div>
                                )}
                            </div>
                            <Separator className='h-px mb-2 bg-gray-300' />
                            <div className=' p-2 bg-white rounded-md shadow-sm border border-gray-200'>
                                <div className='text-black font-semibold text-sm mb-2'>
                                    Method Two: Input parameters to generate
                                </div>
                                <div className='grid grid-cols-3 mb-2 gap-1 text-xs'>
                                    {/* Top Left Corner */}
                                    <div className='relative h-12 flex items-center justify-center'>
                                        <div className='absolute top-0 left-1/4 w-3/4 h-1/2 border-t-2 border-l-2 border-gray-300 rounded-tl'></div>
                                    </div>
                                    {/* North/Top - northEast[1] */}
                                    <div className='text-center -mt-2'>
                                        <span className='font-bold text-blue-600 text-xl'>
                                            N
                                        </span>
                                        {/* Input for North */}
                                        <input
                                            type='number'
                                            value={pageContext.current.inputBounds?.[3] ?? ''}
                                            onChange={(e) => handleSetInputBounds(e, 3)}
                                            className='w-full text-center text-black border border-gray-500 rounded-sm h-[22px]'
                                            placeholder='Enter max Y'
                                            step='any'
                                        />
                                    </div>
                                    {/* Top Right Corner */}
                                    <div className='relative h-12 flex items-center justify-center'>
                                        <div className='absolute top-0 right-1/4 w-3/4 h-1/2 border-t-2 border-r-2 border-gray-300 rounded-tr'></div>
                                    </div>
                                    {/* West/Left - southWest[0] */}
                                    <div className='text-center'>
                                        <span className='font-bold text-green-600 text-xl'>
                                            W
                                        </span>
                                        {/* Input for West */}
                                        <input
                                            type='number'
                                            value={pageContext.current.inputBounds?.[0] ?? ''}
                                            onChange={(e) => handleSetInputBounds(e, 0)}
                                            className='w-full text-center text-black border border-gray-500 rounded-sm h-[22px]'
                                            placeholder='Enter min X'
                                            step='any'
                                        />
                                    </div>
                                    {/* Center */}
                                    <div className='text-center'>
                                        <span className='font-bold text-[#FF8F2E] text-xl'>Center</span>
                                        <div
                                            className='text-[10px] text-black mt-1'
                                        >
                                            {pageContext.current.inputBounds
                                                ? `${formatSingleValue(
                                                    (pageContext.current.inputBounds[0] + pageContext.current.inputBounds[2]) / 2
                                                )}, ${formatSingleValue(
                                                    (pageContext.current.inputBounds[1] + pageContext.current.inputBounds[3]) / 2
                                                )}`
                                                : 'Enter bounds'}
                                        </div>
                                    </div>
                                    {/* East/Right - southEast[0] */}
                                    <div className='text-center'>
                                        <span className='font-bold text-red-600 text-xl'>
                                            E
                                        </span>
                                        {/* Input for East */}
                                        <input
                                            type='number'
                                            value={pageContext.current.inputBounds?.[2] ?? ''}
                                            onChange={(e) => handleSetInputBounds(e, 2)}
                                            className='w-full text-center text-black border border-gray-500 rounded-sm h-[22px]'
                                            placeholder='Enter max X'
                                            step='any'
                                        />
                                    </div>
                                    {/* Bottom Left Corner */}
                                    <div className='relative h-12 flex items-center justify-center'>
                                        <div className='absolute bottom-0 left-1/4 w-3/4 h-1/2 border-b-2 border-l-2 border-gray-300 rounded-bl'></div>
                                    </div>
                                    {/* South/Bottom - southWest[1] */}
                                    <div className='text-center mt-2'>
                                        <span className='font-bold text-purple-600 text-xl'>
                                            S
                                        </span>
                                        {/* Input for South */}
                                        <input
                                            type='number'
                                            value={pageContext.current.inputBounds?.[1] ?? ''}
                                            onChange={(e) => handleSetInputBounds(e, 1)}
                                            className='w-full text-center text-black border border-gray-500 rounded-sm h-[22px]'
                                            placeholder='Enter min Y'
                                            step='any'
                                        />
                                    </div>
                                    {/* Bottom Right Corner */}
                                    <div className='relative h-12 flex items-center justify-center'>
                                        <div className='absolute bottom-0 right-1/4 w-3/4 h-1/2 border-b-2 border-r-2 border-gray-300 rounded-br'></div>
                                    </div>
                                </div>
                                <button
                                    type='button'
                                    className='w-full py-2 px-4 rounded-md font-medium transition-colors cursor-pointer bg-blue-500 text-white hover:bg-blue-600'
                                    onClick={drawBoundsByParams}
                                >
                                    Click to adjust and draw bounds
                                </button>
                            </div>
                        </div>
                    </div>
                    {/* --------------- */}
                    {/* Original Coordinates */}
                    {/* --------------- */}
                    {pageContext.current.convertedBounds &&
                        <div className='mt-4 p-3 bg-white rounded-md shadow-sm border border-gray-200'>
                            <h3 className='font-semibold text-black text-lg mb-2'>Original Bounds (EPSG:{pageContext.current.schema?.epsg ? pageContext.current.schema.epsg.toString() : ''})</h3>
                            <div className='grid grid-cols-3 gap-1 text-xs'>
                                {/* Top Left Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute top-0 left-1/4 w-3/4 h-1/2 border-t-2 border-l-2 border-gray-300 rounded-tl'></div>
                                </div>
                                {/* North/Top - northEast[1] */}
                                <div className='text-center'>
                                    <span className='font-bold text-blue-600 text-xl'>N</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.convertedBounds[3])}]</div>
                                </div>
                                {/* Top Right Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute top-0 right-1/4 w-3/4 h-1/2 border-t-2 border-r-2 border-gray-300 rounded-tr'></div>
                                </div>
                                {/* West/Left - southWest[0] */}
                                <div className='text-center'>
                                    <span className='font-bold text-green-600 text-xl'>W</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.convertedBounds[0])}]</div>
                                </div>
                                {/* Center */}
                                <div className='text-center'>
                                    <span className='font-bold text-[#FF8F2E] text-xl'>Center</span>
                                    <div className='text-black'>{formatCoordinate([(pageContext.current.convertedBounds[0] + pageContext.current.convertedBounds[2]) / 2, (pageContext.current.convertedBounds[1] + pageContext.current.convertedBounds[3]) / 2])}</div>
                                </div>
                                {/* East/Right - southEast[0] */}
                                <div className='text-center'>
                                    <span className='font-bold text-red-600 text-xl'>E</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.convertedBounds[2])}]</div>
                                </div>
                                {/* Bottom Left Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute bottom-0 left-1/4 w-3/4 h-1/2 border-b-2 border-l-2 border-gray-300 rounded-bl'></div>
                                </div>
                                {/* South/Bottom - southWest[1] */}
                                <div className='text-center'>
                                    <span className='font-bold text-purple-600 text-xl'>S</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.convertedBounds[1])}]</div>
                                </div>
                                {/* Bottom Right Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute bottom-0 right-1/4 w-3/4 h-1/2 border-b-2 border-r-2 border-gray-300 rounded-br'></div>
                                </div>
                            </div>
                        </div>
                    }
                    {/* --------------- */}
                    {/* Adjusted Coordinates */}
                    {/* --------------- */}
                    {pageContext.current.adjustedBounds &&
                        <div className='mt-4 p-3 bg-white rounded-md shadow-sm border border-gray-200'>
                            <h3 className='font-semibold text-black text-lg mb-2'>Adjusted Coordinates (EPSG:{pageContext.current.schema?.epsg ? pageContext.current.schema.epsg.toString() : ''})</h3>
                            <div className='grid grid-cols-3 gap-1 text-xs'>
                                {/* Top Left Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute top-0 left-1/4 w-3/4 h-1/2 border-t-2 border-l-2 border-gray-300 rounded-tl'></div>
                                </div>
                                {/* North/Top - northEast[1] */}
                                <div className='text-center'>
                                    <span className='font-bold text-blue-600 text-xl'>N</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.adjustedBounds[3])}]</div>
                                </div>
                                {/* Top Right Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute top-0 right-1/4 w-3/4 h-1/2 border-t-2 border-r-2 border-gray-300 rounded-tr'></div>
                                </div>
                                {/* West/Left - southWest[0] */}
                                <div className='text-center'>
                                    <span className='font-bold text-green-600 text-xl'>W</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.adjustedBounds[0])}]</div>
                                </div>
                                {/* Center */}
                                <div className='text-center'>
                                    <span className='font-bold text-[#FF8F2E] text-xl'>Center</span>
                                    <div className='text-black'>{formatCoordinate([(pageContext.current.adjustedBounds[0] + pageContext.current.adjustedBounds[2]) / 2, (pageContext.current.adjustedBounds[1] + pageContext.current.adjustedBounds[3]) / 2])}</div>
                                </div>
                                {/* East/Right - southEast[0] */}
                                <div className='text-center'>
                                    <span className='font-bold text-red-600 text-xl'>E</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.adjustedBounds[2])}]</div>
                                </div>
                                {/* Bottom Left Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute bottom-0 left-1/4 w-3/4 h-1/2 border-b-2 border-l-2 border-gray-300 rounded-bl'></div>
                                </div>
                                {/* South/Bottom - southWest[1] */}
                                <div className='text-center'>
                                    <span className='font-bold text-purple-600 text-xl'>S</span>
                                    <div className='text-black'>[{formatSingleValue(pageContext.current.adjustedBounds[1])}]</div>
                                </div>
                                {/* Bottom Right Corner */}
                                <div className='relative h-12 flex items-center justify-center'>
                                    <div className='absolute bottom-0 right-1/4 w-3/4 h-1/2 border-b-2 border-r-2 border-gray-300 rounded-br'></div>
                                </div>
                            </div>
                        </div>
                    }
                    {/* --------------- */}
                    {/* General Message */}
                    {/* --------------- */}
                    {generalMessage &&
                        <div
                            className={`p-2 ${bgColor} ${textColor} text-sm rounded-md border ${borderColor}`}
                        >
                            {generalMessage}
                        </div>
                    }
                    {/* ------ */}
                    {/* Submit */}
                    {/* ------ */}
                    <div className='mt-4'>
                        <Button
                            type='button'
                            onClick={handleSubmit}
                            className='w-full bg-green-600 hover:bg-green-700 text-white cursor-pointer'
                        >
                            <Save className='h-4 w-4 mr-2' />
                            Create and Back
                        </Button>
                    </div>
                </div>
            </div>
        </div >
    )
}
