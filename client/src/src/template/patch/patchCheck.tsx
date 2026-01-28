import React, { useEffect, useReducer, useRef, useState } from 'react'
import { IViewContext } from '@/views/IViewContext'
import { MapViewContext } from '@/views/mapView/mapView'
import { IResourceNode } from '../scene/iscene'
import { ResourceNode } from '../scene/scene'
import { Button } from '@/components/ui/button'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, MapPin, SquareMousePointer } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { linkNode } from '../api/node'
import { PatchMeta } from '../api/types'
import * as api from '../api/apis'
import { convertBoundsCoordinates } from '@/utils/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import TopologyLayer from '@/views/mapView/topology/TopologyLayer'
import CustomLayerGroup from '@/views/mapView/topology/customLayerGroup'
import { ensureTopologyLayerInitialized, getOrCreateTopologyLayer } from '@/views/mapView/topology/topologyLayerManager'
import store from '@/store/store'
import PatchCore from '@/core/grid/patchCore'
import { PatchContext } from '@/core/grid/types'
import { boundingBox2D } from '@/core/util/boundingBox2D'

interface PatchCheckProps {
    node: IResourceNode
    context: IViewContext
}

const topologyTips = [
    { tip: 'Hold Shift to select/deselect grids with Brush or Box.' },
    { tip: 'Subdivide splits grids; Merge combines.' },
    { tip: 'Delete removes grids; Recover restores.' },
    { tip: 'Check mode shows grid details; Ctrl+A selects all.' },
]

export default function PatchCheck({ node, context }: PatchCheckProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map!

    const pageContext = useRef<PatchMeta | null>(null)
    const boundsOn4326 = useRef<[number, number, number, number] | null>(null)

    const [topologyLayer, setTopologyLayer] = useState<TopologyLayer | null>(null)

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    useEffect(() => {
        loadContext()

        return () => {
            unloadContext()
        }
    }, [])

    const loadContext = async () => {
        if (!(node as ResourceNode).lockId) {
            // store.get<{ on: Function, off: Function }>('isLoading')!.on()
            const linkResponse = await linkNode('gridmen/IPatch/1.0.0', node.nodeInfo, 'r');
            (node as ResourceNode).lockId = linkResponse.lock_id
            // store.get<{ on: Function, off: Function }>('isLoading')!.off()
        }

        if ((node as ResourceNode).context !== undefined) {
            pageContext.current = { ...(node as ResourceNode).context.patch }
        }

        if ((node as ResourceNode).mountParams === null) {
            const patchInfo = await api.patch.getPatchMeta(node.nodeInfo, (node as ResourceNode).lockId!);
            (node as ResourceNode).mountParams = patchInfo
            pageContext.current = patchInfo
            boundsOn4326.current = await convertBoundsCoordinates(pageContext.current.bounds, pageContext.current.epsg, 4326)
        } else {
            pageContext.current = (node as ResourceNode).mountParams
            boundsOn4326.current = await convertBoundsCoordinates(pageContext.current!.bounds, pageContext.current!.epsg, 4326)
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

        const topologyLayerId = `TopologyLayer:${(node as ResourceNode).nodeInfo}`

        const gridContext: PatchContext = {
            nodeInfo: node.nodeInfo,
            lockId: (node as ResourceNode).lockId!,
            srcCS: `EPSG:${pageContext.current!.epsg}`,
            targetCS: 'EPSG:4326',
            bBox: boundingBox2D(...pageContext.current!.bounds as [number, number, number, number]),
            rules: pageContext.current!.subdivide_rules
        }

        const gridLayer = getOrCreateTopologyLayer(clg, map, topologyLayerId)

        const patchCore: PatchCore = new PatchCore(gridContext)
        await ensureTopologyLayerInitialized(gridLayer, map)

        gridLayer.patchCore = patchCore

        setTopologyLayer(gridLayer)

        map.fitBounds(boundsOn4326.current!, {
            padding: 200,
            duration: 1000,
        });

        (node as ResourceNode).context = {
            ...((node as ResourceNode).context ?? {}),
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
                },
            },
        }

        triggerRepaint()
    }

    const unloadContext = () => {
        // NOTE: Do not remove topology layer here.
        // Layer lifetime is managed by ResourceNode.close() via __cleanup,
        // so switching between views (Check/Edit) won't accidentally unload the grid

        // console.log(pageContext.current.editingState)
        // pageContext.current.editingState.select = selectTab
        // pageContext.current.editingState.pick = pickingTab
        // pageContext.current.isChecking = checkSwitchOn
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
                        Check Patch Cells
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
                    <div className='text-sm w-full flex flex-row items-center px-4'>
                        <Button
                            className='bg-sky-500 hover:bg-sky-600 h-8 text-white cursor-pointer rounded-sm flex'
                            onClick={() => {
                                map.fitBounds(boundsOn4326.current!, {
                                    padding: 200,
                                    duration: 1000
                                })
                            }}
                        >
                            <MapPin className='w-4 h-4' />
                            <span>Navigate</span>
                        </Button>
                    </div>
                </div>
            </div>
            <div className='flex-1 overflow-y-auto min-h-0 scrollbar-hide'>
                <div className='w-4/5 mx-auto p-2'>
                    <div className='text-sm text-white mt-1 grid gap-1'>
                        <div>
                            <span className='font-bold'>Patch Name: </span>
                            {pageContext.current?.name}
                        </div>
                        <div>
                            <span className='font-bold'>Schema: </span>
                            {pageContext.current?.schema_node_key.split('.').pop()}
                        </div>
                        <div>
                            <span className='font-bold'>EPSG: </span>
                            {pageContext.current?.epsg}
                        </div>
                        <div className='flex items-start flex-row gap-0.5'>
                            <div className={`font-bold w-[35%]`}>Grid Levels(m): </div>
                            <div className='space-y-1'>
                                {pageContext.current?.grid_info && (
                                    pageContext.current?.grid_info.map(
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
                                                    <p>{pageContext.current?.bounds[3].toFixed(6)}</p>
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
                                                    <p>{pageContext.current?.bounds[0].toFixed(6)}</p>
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                                {/* Center */}
                                <div className='text-center'>
                                    <span className='font-bold text-[14px] text-orange-500'>Center</span>
                                    <div className='text-[12px]'>
                                        <div>{pageContext.current && ((pageContext.current?.bounds[0] + pageContext.current?.bounds[2]) / 2).toFixed(6)}</div>
                                        <div>{pageContext.current && ((pageContext.current?.bounds[1] + pageContext.current?.bounds[3]) / 2).toFixed(6)}</div>
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
                                                    <p>{pageContext.current?.bounds[2].toFixed(6)}</p>
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
                                                    <p>{pageContext.current?.bounds[1].toFixed(6)}</p>
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
            </div>
        </div>
    )
}
