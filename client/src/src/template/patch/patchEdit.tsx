import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
    X,
    Grip,
    Save,
    Brush,
    ArrowUp,
    ArrowLeft,
    ArrowDown,
    CircleOff,
    ArrowRight,
    FolderOpen,
    SquareDashed,
    SplinePointer,
    SquareMousePointer,
    SquareDashedMousePointer,
} from 'lucide-react'
import { toast } from 'sonner'
import store from '@/store/store'
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
import { linkNode } from '../api/node'
import { PatchMeta } from '../api/types'
import * as api from '@/template/api/apis'
import { ResourceNode } from '../scene/scene'
import PatchCore from '@/core/grid/patchCore'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PatchContext } from '@/core/grid/types'
import { IResourceNode } from '../scene/iscene'
import { useSettingStore } from '@/store/storeSet'
import { IViewContext } from '@/views/IViewContext'
import CapacityBar from '@/components/ui/capacityBar'
import { Separator } from '@/components/ui/separator'
import { MapViewContext } from '@/views/mapView/mapView'
import { convertBoundsCoordinates, getHexColorByValue, vectorColorMap } from '@/utils/utils'
import { boundingBox2D } from '@/core/util/boundingBox2D'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import TopologyLayer from '@/views/mapView/topology/TopologyLayer'
import CustomLayerGroup from '@/views/mapView/topology/customLayerGroup'
import { ensureTopologyLayerInitialized, getOrCreateTopologyLayer } from '@/views/mapView/topology/topologyLayerManager'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface PatchEditProps {
    node: IResourceNode
    context: IViewContext
}

interface PageContext {
    patch: PatchMeta | null
    patchCore: PatchCore | null
    topologyLayer: TopologyLayer | null
    isChecking: boolean
    editingState: {
        pick: boolean,
        select: 'brush' | 'box',
    }
    vectorLockId: string | null
    vectorData: Record<string, any> | null
}

interface GridCheckingInfo {
    storageId: number
    level: number
    globalId: number
    localId: number
    deleted: boolean
}

interface FeaturePickResource {
    kind: 'vector'
    nodeKey: string
    nodeInfo: string
    name: string
}

type TopologyOperationType = 'subdivide' | 'merge' | 'delete' | 'recover' | null

const topologyTips = [
    { tip: 'Hold Shift to select/deselect grids with Brush or Box.' },
    { tip: 'Subdivide splits grids; Merge combines.' },
    { tip: 'Delete removes grids; Recover restores.' },
    { tip: 'Check mode shows grid details; Ctrl+A selects all.' },
]

const topologyOperations = [
    {
        type: 'subdivide',
        text: 'Subdivide',
        activeColor: 'bg-blue-500',
        hoverColor: 'hover:bg-blue-600',
        shortcut: '[ Ctrl+S ]',
    },
    {
        type: 'merge',
        text: 'Merge',
        activeColor: 'bg-green-500',
        hoverColor: 'hover:bg-green-600',
        shortcut: '[ Ctrl+M ]',
    },
    {
        type: 'delete',
        text: 'Delete',
        activeColor: 'bg-red-500',
        hoverColor: 'hover:bg-red-600',
        shortcut: '[ Ctrl+D ]',
    },
    {
        type: 'recover',
        text: 'Recover',
        activeColor: 'bg-orange-500',
        hoverColor: 'hover:bg-orange-600',
        shortcut: '[ Ctrl+R ]',
    },
]

const toPreviewFeatureCollection = (input: any, forcedHexColor: string): GeoJSON.FeatureCollection => {
    const features = Array.isArray(input?.features) ? input.features : []

    const validFeatures = features
        .filter((f: any) => {
            const t = f?.geometry?.type
            if (!t) return false
            if (t === 'Polygon') {
                const ring = f?.geometry?.coordinates?.[0]
                return Array.isArray(ring) && ring.length >= 4
            }
            if (t === 'MultiPolygon') {
                const firstRing = f?.geometry?.coordinates?.[0]?.[0]
                return Array.isArray(firstRing) && firstRing.length >= 4
            }
            if (t === 'LineString') {
                const coords = f?.geometry?.coordinates
                return Array.isArray(coords) && coords.length >= 2
            }
            if (t === 'Point') {
                const coords = f?.geometry?.coordinates
                return Array.isArray(coords) && coords.length >= 2
            }
            return true
        })
        .map((f: any) => {
            const id = f?.id ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
            return {
                ...f,
                id,
                properties: {
                    ...(f?.properties ?? {}),
                    user_color: forcedHexColor,
                },
            }
        })

    return {
        type: 'FeatureCollection',
        features: validFeatures,
    }
}

export default function PatchEdit({ node, context }: PatchEditProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map!
    const drawInstance = mapContext.drawInstance

    const pageContext = useRef<PageContext>({
        patch: null,
        topologyLayer: null,
        patchCore: null,
        isChecking: false,
        editingState: {
            pick: true,
            select: 'brush',
        },
        vectorLockId: null,
        vectorData: null,
    })

    const gridInfo = useRef<GridCheckingInfo | null>(null)

    const highSpeedMode = useSettingStore(state => state.highSpeedMode)

    const [topologyLayer, setTopologyLayer] = useState<TopologyLayer | null>(null)
    const [checkSwitchOn, setCheckSwitchOn] = useState(false)
    const [showDeletedGrid, setShowDeletedGrid] = useState(true)
    const [selectAllDialogOpen, setSelectAllDialogOpen] = useState(false)
    const [deleteSelectDialogOpen, setDeleteSelectDialogOpen] = useState(false)
    const [pickingTab, setPickingTab] = useState<boolean>(true)
    const [selectTab, setSelectTab] = useState<'brush' | 'box'>('brush')
    const [activeTopologyOperation, setActiveTopologyOperation] = useState<TopologyOperationType>(null)
    const [featurePickResource, setFeaturePickResource] = useState<FeaturePickResource | null>(null)

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    useEffect(() => {
        loadContext()

        return () => {
            unloadContext()
        }
    }, [])

    const loadContext = async () => {

        if (!(node as ResourceNode).lockId) {
            store.get<{ on: Function, off: Function }>('isLoading')!.on()
            const linkResponse = await linkNode('gridmen/IPatch/1.0.0', node.nodeInfo, 'w');
            (node as ResourceNode).lockId = linkResponse.lock_id
            store.get<{ on: Function, off: Function }>('isLoading')!.off()
        }

        // if ((node as ResourceNode).context !== undefined) {
        //     pageContext.current = { ...(node as ResourceNode).context }
        // }

        if ((node as ResourceNode).mountParams === null) {
            const patchInfo = await api.patch.getPatchMeta(node.nodeInfo, (node as ResourceNode).lockId!);
            (node as ResourceNode).mountParams = patchInfo
            pageContext.current.patch = patchInfo
        } else {
            pageContext.current.patch = (node as ResourceNode).mountParams
        }

        const waitForMapLoad = () => {
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

        await waitForMapLoad()

        const waitForClg = () => {
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

        const clg = await waitForClg()
        // clg.removeLayer('TopologyLayer')

        const topologyLayerId = `TopologyLayer:${(node as ResourceNode).nodeInfo}`

        const gridContext: PatchContext = {
            nodeInfo: node.nodeInfo,
            lockId: (node as ResourceNode).lockId!,
            srcCS: `EPSG:${pageContext.current.patch?.epsg}`,
            targetCS: 'EPSG:4326',
            bBox: boundingBox2D(...pageContext.current.patch!.bounds as [number, number, number, number]),
            rules: pageContext.current.patch!.subdivide_rules
        }

        const gridLayer = getOrCreateTopologyLayer(clg, map, topologyLayerId)

        const patchCore: PatchCore = new PatchCore(gridContext)
        await ensureTopologyLayerInitialized(gridLayer, map)

        pageContext.current.topologyLayer = gridLayer
        gridLayer.patchCore = patchCore
        pageContext.current.patchCore = patchCore

        setTopologyLayer(pageContext.current.topologyLayer)
        // setPickingTab(pageContext.current.editingState.pick)
        // setSelectTab(pageContext.current.editingState.select)
        setCheckSwitchOn(pageContext.current.isChecking)

        if (pageContext.current.topologyLayer && pageContext.current.isChecking) {
            pageContext.current.topologyLayer.setCheckMode(pageContext.current.isChecking)
        }

        // store.get<{ on: Function, off: Function }>('isLoading')!.off()
        const boundsOn4326 = await convertBoundsCoordinates(pageContext.current.patch!.bounds, pageContext.current.patch!.epsg, 4326)
        map.fitBounds(boundsOn4326, {
            duration: 1000,
            padding: { top: 50, bottom: 50, left: 100, right: 100 }
        });

        (node as ResourceNode).context = {
            ...((node as ResourceNode).context ?? {}),
            topologyLayerId,
            __cleanup: {
                ...(((node as ResourceNode).context as any)?.__cleanup ?? {}),
                topology: () => {
                    try {
                        const clg = store.get<CustomLayerGroup>('clg')
                        clg?.removeLayer(topologyLayerId)
                    } catch (err) {
                        console.error('PatchEdit cleanup failed to remove TopologyLayer:', err)
                    }
                    map.dragPan.enable()
                    map.scrollZoom.enable()
                    if (map.getCanvas()) map.getCanvas().style.cursor = ''

                    pageContext.current.topologyLayer = null
                    pageContext.current.patchCore = null
                },
            },
        }

        triggerRepaint()
    }

    const unloadContext = () => {

        console.log('unloadContext called')
        // topologyLayer!.executeClearSelection()
        // TODO: 无法记录操作按钮的选中状态
        // console.log(pageContext.current.editingState)
        // pageContext.current.editingState.select = selectTab
        // pageContext.current.editingState.pick = pickingTab
        // pageContext.current.isChecking = checkSwitchOn
    }

    useEffect(() => {
        if (!map) return
        if (!topologyLayer) return

        const canvas = map.getCanvas()

        const localIsMouseDown = { current: false }
        const localMouseDownPos = { current: [0, 0] as [number, number] }
        const localMouseMovePos = { current: [0, 0] as [number, number] }

        const onMouseDown = (e: MouseEvent) => {
            if (!e.shiftKey) return
            localIsMouseDown.current = true
            map.dragPan.disable()
            map.scrollZoom.disable()
            const rect = canvas.getBoundingClientRect()
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top
            localMouseDownPos.current = [x, y]

            if (checkSwitchOn) {
                gridInfo.current = topologyLayer.executeCheckCell([x, y])
                triggerRepaint()
            }
        }

        const onMouseMove = (e: MouseEvent) => {
            if (!e.shiftKey || !localIsMouseDown.current) return
            if (checkSwitchOn) return
            const rect = canvas.getBoundingClientRect()
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top
            localMouseMovePos.current = [x, y]

            if (selectTab === 'brush') {
                topologyLayer.executePickCells(
                    selectTab,
                    pickingTab,
                    [localMouseMovePos.current[0], localMouseMovePos.current[1]]
                )
            } else {
                map!.dragPan.disable()
                if (map!.getCanvas()) {
                    map!.getCanvas().style.cursor = 'crosshair'
                }

                topologyLayer.executeDrawBox(
                    [localMouseDownPos.current[0], localMouseDownPos.current[1]],
                    [localMouseMovePos.current[0], localMouseMovePos.current[1]]
                )
            }
        }

        const onMouseUp = (e: MouseEvent) => {
            if (!localIsMouseDown.current) return
            localIsMouseDown.current = false

            if (map) {
                map.dragPan.enable()
                map.scrollZoom.enable()
                topologyLayer.executeClearDrawBox()
                if (map.getCanvas()) {
                    map.getCanvas().style.cursor = ''
                }
            }

            if (!e.shiftKey) return
            if (checkSwitchOn) return

            const rect = canvas.getBoundingClientRect()
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top
            const localMouseUpPos = [x, y]

            topologyLayer.executePickCells(
                selectTab,
                pickingTab,
                [localMouseDownPos.current[0], localMouseDownPos.current[1]],
                [localMouseUpPos[0], localMouseUpPos[1]]
            )
        }

        const onMouseOut = (e: MouseEvent) => {
            if (checkSwitchOn) return
            if (map) {
                map.dragPan.enable()
                map.scrollZoom.enable()
                topologyLayer.executeClearDrawBox()
                if (map.getCanvas()) {
                    map.getCanvas().style.cursor = ''
                }
            }
            if (!e.shiftKey) return

            const rect = canvas.getBoundingClientRect()
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top
            const mouseUpPos = [x, y]

            topologyLayer.executePickCells(
                selectTab,
                pickingTab,
                [localMouseDownPos.current[0], localMouseDownPos.current[1]],
                [mouseUpPos[0], mouseUpPos[1]]
            )
        }

        canvas.addEventListener('mousedown', onMouseDown)
        canvas.addEventListener('mousemove', onMouseMove)
        canvas.addEventListener('mouseup', onMouseUp)
        canvas.addEventListener('mouseout', onMouseOut)

        return () => {
            canvas.removeEventListener('mousedown', onMouseDown)
            canvas.removeEventListener('mousemove', onMouseMove)
            canvas.removeEventListener('mouseup', onMouseUp)
            canvas.removeEventListener('mouseout', onMouseOut)
        }
    }, [map, topologyLayer, selectTab, pickingTab, checkSwitchOn])

    const handleConfirmSelectAll = useCallback(() => {
        setSelectAllDialogOpen(false)
        topologyLayer!.executePickAllCells()
    }, [topologyLayer])

    const handleConfirmDeleteSelect = useCallback(() => {
        setDeleteSelectDialogOpen(false)
        topologyLayer!.executeClearSelection()
    }, [topologyLayer])

    const handleConfirmTopologyAction = useCallback(() => {
        switch (activeTopologyOperation) {
            case 'subdivide':
                topologyLayer!.executeSubdivideCells()
                break
            case 'merge':
                topologyLayer!.executeMergeCells()
                break
            case 'delete':
                topologyLayer!.executeDeleteCells()
                break
            case 'recover':
                topologyLayer!.executeRecoverCells()
                break
            default:
                console.warn('No active topology operation to confirm.')
        }
        setActiveTopologyOperation(null)
    }, [activeTopologyOperation, topologyLayer])

    const handleSelectAllClick = () => {
        if (highSpeedMode) {
            handleConfirmSelectAll()
            return
        }
        setSelectAllDialogOpen(true)
    }

    const handleDeleteSelectClick = () => {
        if (highSpeedMode) {
            handleConfirmDeleteSelect()
            return
        }
        setDeleteSelectDialogOpen(true)
    }

    const handleVectorNodeDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.currentTarget.classList.add('border-blue-500', 'bg-blue-50')
    }

    const handleVectorNodeDragLeave = (e: React.DragEvent) => {
        e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50')
    }

    const handleVectorNodeDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50')
        const raw = e.dataTransfer.getData('application/gridmen-node') || e.dataTransfer.getData('text/plain')

        try {
            const payload = JSON.parse(raw) as {
                nodeKey: string
                nodeInfo: string
                nodeLockId: string | null
                templateName: string
                sourceTreeTitle: string
            }

            const { nodeInfo: dragNodeInfo, nodeKey: dragNodeKey, nodeLockId: dragNodeLockId, templateName } = payload

            if (!dragNodeKey || templateName !== 'vector') {
                toast.error('Please drag a vector node')
                return
            }

            pageContext.current.vectorLockId = dragNodeLockId

            setFeaturePickResource({
                kind: 'vector',
                nodeKey: dragNodeKey,
                nodeInfo: dragNodeInfo,
                name: payload.sourceTreeTitle || 'Vector'
            })

            const vectorData = await api.vector.getVector(dragNodeInfo, dragNodeLockId || '')
            console.log('Dragged vector data:', vectorData.data)
            pageContext.current.vectorData = vectorData.data

            try {
                const hex = getHexColorByValue((vectorData.data as any)?.color)
                const fc = toPreviewFeatureCollection((vectorData.data as any)?.feature_json, hex)

                if (drawInstance) {
                    drawInstance.deleteAll()
                    if (fc.features.length > 0) {
                        drawInstance.add(fc as any)
                        const all = drawInstance.getAll()
                        for (const feature of all.features as any[]) {
                            if (!feature?.id) continue
                            drawInstance.setFeatureProperty(feature.id, 'user_color', hex)
                        }
                    }
                }
            } catch (renderErr) {
                console.warn('Failed to render dragged vector on map:', renderErr)
            }

            triggerRepaint()
        } catch (error) {
            console.error('Invalid drag payload:', error)
            toast.error('Invalid drag data')
        }
    }

    const handleClearUploadedFeature = () => {
        setFeaturePickResource(null)

        try {
            drawInstance?.deleteAll()
        } catch (e) {
            console.warn('Failed to clear draw preview:', e)
        }

        pageContext.current.vectorLockId = null
        pageContext.current.vectorData = null
    }

    const handleSelectFeaturePick = useCallback(async () => {
        if (!topologyLayer) {
            toast.error('Topology layer not ready')
            return
        }

        if (!featurePickResource) {
            toast.error('Please drag a vector node or upload a feature file')
            return
        }

        try {
            // store.get<{ on: Function; off: Function }>('isLoading')!.on()

            if (featurePickResource.kind === 'vector') {
                topologyLayer.executePickCellsByVectorNode(featurePickResource.nodeInfo, pageContext.current.vectorLockId, pickingTab)
                return
            }
        } catch (error) {
            console.error('Error executing feature pick:', error)
            // store.get<{ on: Function; off: Function }>('isLoading')!.off()
            toast.error('Failed to execute feature pick')
        }
    }, [featurePickResource, topologyLayer, pickingTab])

    const onTopologyOperationClick = (operationType: string) => {
        if (highSpeedMode && operationType !== null) {
            switch (operationType) {
                case 'subdivide':
                    topologyLayer!.executeSubdivideCells()
                    break
                case 'merge':
                    topologyLayer!.executeMergeCells()
                    break
                case 'delete':
                    topologyLayer!.executeDeleteCells()
                    break
                case 'recover':
                    topologyLayer!.executeRecoverCells()
                    break
                default:
                    console.warn('Unknown topology operation type:', operationType)
            }
        } else {
            setActiveTopologyOperation(operationType as TopologyOperationType)
        }
    }

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (checkSwitchOn) return
            if (event.ctrlKey || event.metaKey) {
                if (event.key === 'P' || event.key === 'p') {
                    event.preventDefault()
                    setPickingTab(true)
                }
                if (event.key === 'U' || event.key === 'u') {
                    event.preventDefault()
                    setPickingTab(false)
                }
                if (event.key === 'A' || event.key === 'a') {
                    event.preventDefault()
                    if (highSpeedMode) {
                        handleConfirmSelectAll()
                    } else {
                        setSelectAllDialogOpen(true)
                    }
                }
                if (event.key === 'C' || event.key === 'c') {
                    event.preventDefault()
                    if (highSpeedMode) {
                        handleConfirmDeleteSelect()
                    } else {
                        setDeleteSelectDialogOpen(true)
                    }
                }
                if (event.key === '1') {
                    event.preventDefault()
                    pageContext.current!.editingState.select = 'brush'
                    setSelectTab('brush')
                }
                if (event.key === '2') {
                    event.preventDefault()
                    pageContext.current!.editingState.select = 'box'
                    setSelectTab('box')
                }
                if (event.key === 'S' || event.key === 's') {
                    event.preventDefault()
                    if (highSpeedMode) {
                        topologyLayer!.executeSubdivideCells()
                    } else {
                        setActiveTopologyOperation('subdivide')
                    }
                }
                if (event.key === 'M' || event.key === 'm') {
                    event.preventDefault()
                    if (highSpeedMode) {
                        topologyLayer!.executeMergeCells()
                    } else {
                        setActiveTopologyOperation('merge')
                    }
                }
                if (event.key === 'D' || event.key === 'd') {
                    event.preventDefault()
                    if (highSpeedMode) {
                        topologyLayer!.executeDeleteCells()
                    } else {
                        setActiveTopologyOperation('delete')
                    }
                }
                if (event.key === 'R' || event.key === 'r') {
                    event.preventDefault()
                    if (highSpeedMode) {
                        topologyLayer!.executeRecoverCells()
                    } else {
                        setActiveTopologyOperation('recover')
                    }
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown)

        return () => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [
        setPickingTab,
        handleConfirmDeleteSelect,
        handleConfirmSelectAll,
        selectTab,
        topologyLayer,
        checkSwitchOn,
        highSpeedMode
    ])

    const toggleCheckSwitch = () => {
        if (checkSwitchOn === pageContext.current!.isChecking) {
            const newCheckState = !checkSwitchOn
            setCheckSwitchOn(newCheckState)
            pageContext.current!.isChecking = newCheckState

            if (topologyLayer) {
                topologyLayer.setCheckMode(newCheckState)
            }
        }
    }

    const toggleShowDeletedGridSwitch = () => {
        const newShowDeletedState = !showDeletedGrid

        if (topologyLayer) {
            topologyLayer.showDeletedCells = newShowDeletedState
        }

        setShowDeletedGrid(newShowDeletedState)
    }

    const handleSaveTopologyState = () => {
        const core: PatchCore = pageContext.current.patchCore!
        core.save(() => {
            toast.success(`Topology edit state of ${pageContext.current.patch?.name} saved successfully`)
        })
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
                            <SquareMousePointer className='h-6 w-6 text-white' />
                        </AvatarFallback>
                    </Avatar>
                    <h1 className='font-bold text-[25px] relative flex items-center'>
                        Edit Patch Topology
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
                            {topologyTips.map((tip, index) => (
                                <li key={index}>
                                    {Object.values(tip)[0]}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className='text-sm w-full flex flex-row items-center justify-between space-x-2'>
                        <CapacityBar gridCore={pageContext.current.patchCore!} />
                        <div className='space-y-2'>
                            <div className='flex flex-row items-center justify-between gap-2'>
                                <div
                                    className='bg-sky-500 hover:bg-sky-600 h-8 p-2 text-white cursor-pointer rounded-sm flex items-center px-4'
                                    onClick={toggleCheckSwitch}
                                >
                                    <span>Check</span>
                                    <Separator orientation='vertical' className='h-4 mx-2' />
                                    <Switch
                                        className='data-[state=checked]:bg-amber-300 data-[state=unchecked]:bg-gray-300 cursor-pointer'
                                        checked={checkSwitchOn}
                                        onCheckedChange={toggleCheckSwitch}
                                    />
                                </div>

                                <Button
                                    className='bg-green-500 hover:bg-green-600 h-8 text-white cursor-pointer rounded-sm flex'
                                    onClick={handleSaveTopologyState}
                                >
                                    <span>Save</span>
                                    <Separator orientation='vertical' className='h-4' />
                                    <Save className='w-4 h-4' />
                                </Button>
                            </div>
                            <div
                                className='bg-orange-500 hover:bg-orange-600 h-8 p-2 text-white cursor-pointer rounded-sm flex items-center px-4'
                                onClick={toggleShowDeletedGridSwitch}
                            >
                                <span className='shrink-0'>Show Deleted Cells</span>
                                <Separator orientation='vertical' className='h-4 mx-2' />
                                <div className='flex-1 flex justify-center'>
                                    <Switch
                                        className='data-[state=checked]:bg-sky-300 data-[state=unchecked]:bg-gray-300 cursor-pointer'
                                        checked={showDeletedGrid}
                                        onCheckedChange={toggleShowDeletedGridSwitch}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div className='flex-1 overflow-y-auto min-h-0 scrollbar-hide'>
                <div className='w-4/5 mx-auto p-2'>
                    <div className='text-sm text-white mt-1 grid gap-1'>
                        <div>
                            <span className='font-bold'>Patch Name: </span>
                            {pageContext.current.patch?.name}
                        </div>
                        <div>
                            <span className='font-bold'>Schema: </span>
                            {pageContext.current.patch?.schema_node_key.split('.').pop()}
                        </div>
                        <div>
                            <span className='font-bold'>EPSG: </span>
                            {pageContext.current.patch?.epsg}
                        </div>
                        <div className='flex items-start flex-row gap-0.5'>
                            <div className={`font-bold w-[35%]`}>Grid Levels(m): </div>
                            <div className='space-y-1'>
                                {pageContext.current?.patch?.grid_info && (
                                    pageContext.current?.patch?.grid_info.map(
                                        (level: number[], index: number) => {
                                            const color = topologyLayer!.paletteColorList ?
                                                [topologyLayer!.paletteColorList[(index + 1) * 3], topologyLayer!.paletteColorList[(index + 1) * 3 + 1], topologyLayer!.paletteColorList[(index + 1) * 3 + 2]] : null
                                            const colorStyle = color ? `rgb(${color[0]}, ${color[1]}, ${color[2]})` : undefined

                                            return (
                                                <div key={index} className='text-sm'
                                                    style={{ color: colorStyle }}
                                                >
                                                    level {index + 1}: [{level.join(', ')}]
                                                </div>
                                            )
                                        }
                                    )
                                )}
                            </div>
                        </div>
                        <div className='font-bold'>
                            <span className='text-white'>BoundingBox:</span>
                            {/* {bounds ? ( */}
                            <div className='grid grid-cols-3 gap-1 text-xs text-white mt-4'>
                                {/* Top Left Corner */}
                                <div className='relative h-8 flex items-center justify-center'>
                                    <div className='absolute top-0 left-1/4 w-3/4 h-1/2 border-t border-l border-gray-300 rounded-tl'></div>
                                </div>
                                {/* North/Top */}
                                <div className='text-center'>
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className='flex flex-col items-center'>
                                                    <ArrowUp className='h-4 w-4 text-blue-500' />
                                                    <span className='font-bold text-blue-500 text-sm mb-1'>N</span>
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <div className='text-[12px] space-y-1'>
                                                    <p className='font-bold text-blue-500'>North</p>
                                                    <p>{pageContext.current?.patch?.bounds[3].toFixed(6)}</p>
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                                {/* Top Right Corner */}
                                <div className='relative h-8 flex items-center justify-center'>
                                    <div className='absolute top-0 right-1/4 w-3/4 h-1/2 border-t border-r border-gray-300 rounded-tr'></div>
                                </div>
                                {/* West/Left */}
                                <div className='text-center'>
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className='flex flex-row items-center justify-center gap-1 mt-2'>
                                                    <ArrowLeft className='h-4 w-4 text-green-500' />
                                                    <span className='font-bold text-green-500 text-sm mr-1 mt-1'>W</span>
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <div className='text-[12px]'>
                                                    <p className='font-bold mb-1 text-green-500'>West</p>
                                                    <p>{pageContext.current?.patch?.bounds[0].toFixed(6)}</p>
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                                {/* Center */}
                                <div className='text-center'>
                                    <span className='font-bold text-[14px] text-orange-500'>Center</span>
                                    <div className='text-[12px]'>
                                        <div>{pageContext.current?.patch && ((pageContext.current?.patch?.bounds[0] + pageContext.current?.patch?.bounds[2]) / 2).toFixed(6)}</div>
                                        <div>{pageContext.current?.patch && ((pageContext.current?.patch?.bounds[1] + pageContext.current?.patch?.bounds[3]) / 2).toFixed(6)}</div>
                                    </div>
                                </div>
                                {/* East/Right */}
                                <div className='text-center'>
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className='flex flex-row items-center justify-center gap-1 mt-2'>
                                                    <span className='font-bold text-red-500 text-sm mt-1 ml-4'>E</span>
                                                    <ArrowRight className='h-4 w-4 text-red-500' />
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <div className='text-[12px]'>
                                                    <p className='font-bold mb-1 text-red-500'>East</p>
                                                    <p>{pageContext.current?.patch?.bounds[2].toFixed(6)}</p>
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                                {/* Bottom Left Corner */}
                                <div className='relative h-8 flex items-center justify-center'>
                                    <div className='absolute bottom-0 left-1/4 w-3/4 h-1/2 border-b border-l border-gray-300 rounded-bl'></div>
                                </div>
                                {/* South/Bottom */}
                                <div className='text-center'>
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className='flex flex-col items-center'>
                                                    <span className='font-bold text-purple-500 text-sm mt-1'>S</span>
                                                    <ArrowDown className='h-4 w-4 text-purple-500' />
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <div className='text-[12px]'>
                                                    <p className='font-bold mb-1 text-purple-500'>South</p>
                                                    <p>{pageContext.current?.patch?.bounds[1].toFixed(6)}</p>
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                                {/* Bottom Right Corner */}
                                <div className='relative h-8 flex items-center justify-center'>
                                    <div className='absolute bottom-0 right-1/4 w-3/4 h-1/2 border-b border-r border-gray-300 rounded-br'></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className='w-full flex flex-col border-t-2 border-[#414141] relative mb-2'>
                    <div className='w-full mx-auto space-y-4 px-4 relative'>
                        {checkSwitchOn && (
                            <div className='absolute h-full -mb-2 inset-0 z-10 bg-black/10 flex items-center justify-center backdrop-blur-sm pointer-events-auto'>
                                <div className=' text-white px-6 py-3 rounded-lg text-center'>
                                    <span className='text-3xl font-bold'>Check Mode On</span>
                                    <p className='text-sm mt-1'>Please click the grid to view information</p>
                                </div>
                            </div>
                        )}
                        <div className='space-y-2 p-2'>
                            <AlertDialog
                                open={selectAllDialogOpen}
                                onOpenChange={setSelectAllDialogOpen}
                            >
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>
                                            Operation Confirm
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Are you sure you want to select all grids?
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel
                                            className='cursor-pointer'
                                            onClick={() => { setPickingTab(true) }}
                                        >
                                            Cancel
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={handleConfirmSelectAll}
                                            className='bg-green-500 hover:bg-green-600 cursor-pointer'
                                        >
                                            Confirm
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                            <AlertDialog
                                open={deleteSelectDialogOpen}
                                onOpenChange={setDeleteSelectDialogOpen}
                            >
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>
                                            Operation Confirm
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Are you sure you want to cancel all selections?
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel
                                            className='cursor-pointer'
                                            onClick={() => { setPickingTab(true) }}
                                        >
                                            Cancel
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={handleConfirmDeleteSelect}
                                            className='bg-red-500 hover:bg-red-600 cursor-pointer'
                                        >
                                            Confirm
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                            <AlertDialog
                                open={activeTopologyOperation !== null}
                                onOpenChange={(open) => {
                                    if (!open) { setActiveTopologyOperation(null) }
                                }}
                            >
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>
                                            Operation Confirm
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                            {activeTopologyOperation ===
                                                'subdivide'
                                                ? 'Are you sure you want to subdivide the selected grids?'
                                                : activeTopologyOperation === 'merge'
                                                    ? 'Are you sure you want to merge the selected grids?'
                                                    : activeTopologyOperation === 'delete'
                                                        ? 'Are you sure you want to delete the selected grids?'
                                                        : activeTopologyOperation === 'recover'
                                                            ? 'Are you sure you want to recover the selected grids?'
                                                            : ''}
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel className='cursor-pointer'>
                                            Cancel
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={handleConfirmTopologyAction}
                                            className={
                                                activeTopologyOperation === 'subdivide'
                                                    ? 'bg-blue-500 hover:bg-blue-600 cursor-pointer'
                                                    : activeTopologyOperation ===
                                                        'merge'
                                                        ? 'bg-green-500 hover:bg-green-600 cursor-pointer'
                                                        : activeTopologyOperation ===
                                                            'delete'
                                                            ? 'bg-red-500 hover:bg-red-600 cursor-pointer'
                                                            : activeTopologyOperation ===
                                                                'recover'
                                                                ? 'bg-orange-500 hover:bg-orange-600 cursor-pointer'
                                                                : 'bg-gray-500 cursor-not-allowed'
                                            }
                                            disabled={activeTopologyOperation === null}
                                        >
                                            {activeTopologyOperation ===
                                                'subdivide'
                                                ? 'Subdivide'
                                                : activeTopologyOperation === 'merge'
                                                    ? 'Merge'
                                                    : activeTopologyOperation === 'delete'
                                                        ? 'Delete'
                                                        : activeTopologyOperation === 'recover'
                                                            ? 'Recover'
                                                            : 'Confirm'}
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                            <div className='space-y-2'>
                                <h1 className='text-2xl font-bold text-white'>Picking</h1>
                                <div className='mt-2'>
                                    <h3 className='text-md mb-1 font-bold text-white'>Operation</h3>
                                    <div className='flex items-center gap-1 p-1 h-[64px] border border-gray-200 rounded-lg'>
                                        <button
                                            className={`flex-1 py-2 px-3 rounded-md transition-colors text-white duration-200 flex flex-col text-sm justify-center items-center ${checkSwitchOn ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} 
                                                            ${pickingTab === true ? 'bg-gray-600 ' : 'bg-transparent hover:bg-gray-500'}`}
                                            onClick={() => { !checkSwitchOn && setPickingTab(true) }}
                                            disabled={checkSwitchOn}
                                        >
                                            <div className='flex flex-row gap-1 items-center'>
                                                <SquareMousePointer className='h-4 w-4' />
                                                Picking
                                            </div>
                                            <div className={`text-xs ${pickingTab === true && ' text-white'}`}>
                                                [ Ctrl+P ]
                                            </div>
                                        </button>
                                        <button
                                            className={`flex-1 py-2 px-3 rounded-md transition-colors text-white duration-200 flex flex-col text-sm justify-center items-center ${checkSwitchOn ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} 
                                                            ${pickingTab === false ? 'bg-gray-700 ' : 'bg-transparent hover:bg-gray-500'}`}
                                            onClick={() => { !checkSwitchOn && setPickingTab(false) }}
                                            disabled={checkSwitchOn}
                                        >
                                            <div className='flex flex-row gap-1 items-center'>
                                                <SquareDashedMousePointer className='h-4 w-4' />
                                                Unpicking
                                            </div>
                                            <div className={`text-xs ${pickingTab === false && ' text-white'}`}>
                                                [Ctrl+U]
                                            </div>
                                        </button>
                                    </div>
                                    <div className='flex items-center gap-1 p-1 mt-2 h-[64px] border border-gray-200 rounded-lg'>
                                        <button
                                            className={`flex-1 py-2 px-3 rounded-md text-white transition-colors duration-200 flex flex-col text-sm justify-center items-center ${checkSwitchOn ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} 
                                                            ${selectAllDialogOpen ? 'bg-green-500 ' : ' hover:bg-green-500'}`}
                                            onClick={() => { !checkSwitchOn && handleSelectAllClick() }}
                                            disabled={checkSwitchOn}
                                        >
                                            <div className='flex flex-row gap-1 items-center'>
                                                <Grip className='h-4 w-4' />
                                                Select All
                                            </div>
                                            <div className={`text-xs ${selectAllDialogOpen && ' text-white'}`}>
                                                [ Ctrl+A ]
                                            </div>
                                        </button>
                                        <button
                                            className={`flex-1 py-2 px-3 rounded-md text-white transition-colors duration-200 flex flex-col text-sm justify-center items-center ${checkSwitchOn ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} 
                                                            ${deleteSelectDialogOpen ? 'bg-red-500 ' : ' hover:bg-red-500'}`}
                                            onClick={() => { !checkSwitchOn && handleDeleteSelectClick() }}
                                            disabled={checkSwitchOn}
                                        >
                                            <div className='flex flex-row gap-1 items-center'>
                                                <CircleOff className='h-4 w-4' />
                                                Cancel All
                                            </div>
                                            <div className={`text-xs ${deleteSelectDialogOpen && ' text-white'}`}>
                                                [ Ctrl+C ]
                                            </div>
                                        </button>
                                    </div>
                                </div>
                                <div className='mb-2'>
                                    <h3 className='text-md mb-1 font-bold text-white'>Mode</h3>
                                    <div className='flex items-center h-[64px] mb-1 p-1 gap-1 rounded-lg border border-gray-200 shadow-md'>
                                        <button
                                            className={` flex-1 py-2 px-3 rounded-md transition-colors duration-200 text-white flex flex-col gap-0.5 text-sm justify-center items-center ${checkSwitchOn ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} 
                                                            ${selectTab === 'brush' ? 'bg-[#FF8F2E] ' : ' hover:bg-gray-500'}`}
                                            onClick={() => { !checkSwitchOn && setSelectTab('brush') }}
                                            disabled={checkSwitchOn}
                                        >
                                            <div className='flex flex-row gap-1 items-center'>
                                                <Brush className='h-4 w-4' />
                                                Brush
                                            </div>
                                            <div className={`text-xs ${selectTab === 'brush' && 'text-white'} `}>
                                                [ Ctrl+1 ]
                                            </div>
                                        </button>
                                        <button
                                            className={`flex-1 py-2 px-3 rounded-md transition-colors duration-200 text-white flex flex-col gap-0.5 text-sm justify-center items-center ${checkSwitchOn ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} 
                                                            ${selectTab === 'box' ? 'bg-[#FF8F2E] ' : ' hover:bg-gray-500'}`}
                                            onClick={() => { !checkSwitchOn && setSelectTab('box') }}
                                            disabled={checkSwitchOn}
                                        >
                                            <div className='flex flex-row gap-1 items-center'>
                                                <SquareDashed className='h-4 w-4' />
                                                Box
                                            </div>
                                            <div className={`text-xs ${selectTab === 'box' && 'text-white'} `}>
                                                [ Ctrl+2 ]
                                            </div>
                                        </button>
                                    </div>
                                    <div className='mb-1 p-1 gap-1 shadow-md'>
                                        <div className='flex flex-row gap-1 items-center'>
                                            <FolderOpen className='h-4 w-4' />
                                            <span>Pick or Unpick Cells By Vector</span>
                                        </div>
                                        <div className='space-y-2 mt-2'>
                                            <div
                                                onDragOver={handleVectorNodeDragOver}
                                                onDragLeave={handleVectorNodeDragLeave}
                                                onDrop={handleVectorNodeDrop}
                                                className='border-2 w-full p-2 border-dashed border-gray-300 rounded-lg text-center transition-all duration-200 hover:border-blue-400 hover:bg-gray-700/50 group'
                                            >
                                                {featurePickResource ? (
                                                    <div className='space-y-2'>
                                                        <div className='flex items-center justify-between bg-white rounded-md p-2 border border-blue-300'>
                                                            <span className='text-sm font-medium text-gray-900'>
                                                                {featurePickResource.name}
                                                            </span>
                                                            <button
                                                                onClick={handleClearUploadedFeature}
                                                                className='text-red-500 hover:text-red-600 cursor-pointer'
                                                            >
                                                                <X className='h-4 w-4' />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className='space-y-2 py-1'>
                                                        <SplinePointer className='h-8 w-8 mx-auto text-gray-400 group-hover:text-indigo-500 transition-colors' />
                                                        <p className='text-sm text-gray-400 group-hover:text-indigo-500 transition-colors'>
                                                            Drag a Vector node here
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                            <div className='flex gap-2'>
                                                <Button
                                                    onClick={handleSelectFeaturePick}
                                                    disabled={!featurePickResource}
                                                    className='flex-1 bg-green-600 hover:bg-green-700 text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
                                                >
                                                    Apply
                                                </Button>
                                                <Button
                                                    onClick={handleClearUploadedFeature}
                                                    disabled={!featurePickResource}
                                                    className='flex-1 bg-red-500 hover:bg-red-600 text-white cursor-pointer'
                                                >
                                                    Clear
                                                </Button>

                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className='space-y-2'>
                                <h1 className='text-2xl font-bold text-white'>Topology</h1>
                                <div className='flex items-center h-[56px] mt-2 p-1 space-x-1 border border-gray-200 rounded-lg shadow-md'>
                                    {topologyOperations.map((operation) => (
                                        <button
                                            key={operation.type}
                                            className={`flex-1 py-1 px-2 rounded-md transition-colors duration-200 flex flex-col gap-0.5 text-sm justify-center items-center ${checkSwitchOn ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer text-white'} 
                                                            ${activeTopologyOperation === operation.type ? operation.activeColor : `${operation.hoverColor}`}`}
                                            onClick={() => { !checkSwitchOn && onTopologyOperationClick(operation.type) }}
                                            disabled={checkSwitchOn}
                                        >
                                            <div className='flex flex-row items-center'>
                                                {operation.text}
                                            </div>
                                            <div className='text-xs text-white'>
                                                {operation.shortcut}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* ////////////////////////////////////////////////////////////////// */}
                    {/* ////////////////////////////////////////////////////////////////// */}
                    {/* ////////////////////////////////////////////////////////////////// */}
                    <Separator className='mb-2 bg-[#414141]' />
                    <div className='w-full mx-auto space-y-4 px-4'>
                        <div className='space-y-2 p-2 mb-4'>
                            <h1 className='text-2xl font-bold text-white'>Checking</h1>
                            <div className='space-y-2 p-1 text-white'>
                                <div className='flex flex-col'>
                                    <span className='text-sm font-medium text-gray-300'>Level</span>
                                    <span className='text-lg font-semibold'>{gridInfo.current?.level ?? '-'}</span>
                                </div>
                                <div className='flex flex-col'>
                                    <span className='text-sm font-medium text-gray-300'>Local ID</span>
                                    <span className='text-lg font-semibold'>{gridInfo.current?.localId ?? '-'}</span>
                                </div>
                                <div className='flex flex-col'>
                                    <span className='text-sm font-medium text-gray-300'>Deleted</span>
                                    <span className='text-lg font-semibold'>
                                        {gridInfo.current?.deleted === true
                                            ? 'True'
                                            : gridInfo.current?.deleted === false
                                                ? 'False'
                                                : '-'}
                                    </span>
                                </div>
                                <div className='flex flex-col'>
                                    <span className='text-sm font-medium text-gray-300'>Global ID</span>
                                    <span className='text-lg font-semibold'>{gridInfo.current?.globalId ?? '-'}</span>
                                </div>
                                <div className='flex flex-col'>
                                    <span className='text-sm font-medium text-gray-300'>Storage ID</span>
                                    <span className='text-lg font-semibold'>{gridInfo.current?.storageId ?? '-'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
