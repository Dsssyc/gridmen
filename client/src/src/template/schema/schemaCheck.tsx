import { useEffect, useReducer, useRef } from 'react'
import * as api from '@/template/api/apis'
import { SchemaData } from './types'
import { linkNode } from '../api/node'
import { MapPin, MapPinPlus } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { ResourceNode } from '../scene/scene'
import { IResourceNode } from '../scene/iscene'
import { IViewContext } from '@/views/IViewContext'
import { MapViewContext } from '@/views/mapView/mapView'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { addMapMarker, clearMarkerByNodeKey, convertPointCoordinate } from '@/utils/utils'
import { Button } from '@/components/ui/button'
import store from '@/store/store'

interface SchemaCheckProps {
    node: IResourceNode
    context: IViewContext
}

const schemaTips = [
    { tip1: 'You are in Schema check mode.' },
    { tip2: 'All fields are read-only; use this panel to review the configuration.' },
    { tip3: 'Click Navigate to zoom to the alignment origin on the map.' },
]


export default function SchemaCheck({ node, context }: SchemaCheckProps) {
    const mapContext = context as MapViewContext
    const map = mapContext.map!

    const alignmentOriginOn4326 = useRef<[number, number] | null>(null)

    const pageContext = useRef<SchemaData | null>(null)

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    useEffect(() => {
        loadContext()

        return () => unloadContext()
    }, [])

    const loadContext = async () => {
        if (!(node as ResourceNode).lockId) {
            store.get<{ on: Function, off: Function }>('isLoading')!.on()
            console.log('触发3')
            const linkResponse = await linkNode('gridmen/ISchema/1.0.0', node.nodeInfo, 'r');
            (node as ResourceNode).lockId = linkResponse.lock_id
            store.get<{ on: Function, off: Function }>('isLoading')!.off()
        }

        if ((node as ResourceNode).mountParams === null) {
            const schemaNode: any = await api.node.getNodeParams(node.nodeInfo);
            (node as ResourceNode).mountParams = schemaNode
            const parsed = JSON.parse(schemaNode.mount_params) as SchemaData
            pageContext.current = parsed
            alignmentOriginOn4326.current = await convertPointCoordinate(parsed.alignment_origin, parsed.epsg, 4326)
            addMapMarker(map, alignmentOriginOn4326.current!, node.nodeInfo, { color: 'red' })
        } else {
            pageContext.current = (node as ResourceNode).mountParams
            alignmentOriginOn4326.current = await convertPointCoordinate(pageContext.current!.alignment_origin, pageContext.current!.epsg, 4326)
            addMapMarker(map, alignmentOriginOn4326.current!, node.nodeInfo, { color: 'red' })
        }

        (node as ResourceNode).context = {
            ...((node as ResourceNode).context ?? {}),
            __cleanup: {
                ...(((node as ResourceNode).context as any)?.__cleanup ?? {}),
                marker: () => clearMarkerByNodeKey(node.nodeInfo),
            },
        }

        triggerRepaint()
    }

    const unloadContext = () => {
        // cleanup is handled by node.close() when the layer is removed
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
                            <MapPinPlus className='h-6 w-6 text-white' />
                        </AvatarFallback>
                    </Avatar>
                    <h1 className='font-bold text-[25px] relative flex items-center'>
                        Check Schema
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
                            {schemaTips.map((tip, index) => (
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
                                map.flyTo({
                                    center: alignmentOriginOn4326.current ?? [0, 0],
                                    zoom: 15,
                                    duration: 1000,
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
                <div className='w-full mx-auto space-y-2 px-6 pt-2 pb-4'>
                    {/* ----------- */}
                    {/* Schema Name */}
                    {/* ----------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                        <h2 className='text-black text-lg font-semibold mb-2'>
                            Schema Name
                        </h2>
                        <div className='space-y-2'>
                            <Input
                                id='name'
                                value={pageContext.current?.name ?? ''}
                                readOnly={true}
                                className='w-full text-black border-gray-300'
                            />
                        </div>
                    </div>
                    {/* --------- */}
                    {/* EPSG Code */}
                    {/* --------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200'>
                        <h2 className='text-black text-lg font-semibold mb-2'>
                            EPSG Code
                        </h2>
                        <div className='space-y-2'>
                            <Input
                                id='epsg'
                                value={pageContext.current?.epsg ?? ''}
                                readOnly={true}
                                className='text-black w-full border-gray-300'
                            />
                        </div>
                    </div>
                    {/* ----------------------- */}
                    {/* Coordinates */}
                    {/* ----------------------- */}
                    <div className='bg-white rounded-lg shadow-sm p-4 border border-gray-200 text-black'>
                        <h2 className='text-lg font-semibold mb-2'>
                            Alignment Coordinates
                        </h2>
                        <div className='flex-1 flex flex-col justify-between'>
                            <div className='flex items-center gap-2 mb-2 '>
                                <Label className='text-sm font-medium w-1/4'>X:</Label>
                                <div className='w-3/4 p-2 bg-gray-100 rounded border border-gray-300'>
                                    {pageContext.current?.alignment_origin[0]}
                                </div>
                            </div>

                            <div className='flex items-center gap-2'>
                                <Label className='text-sm font-medium w-1/4'>Y:</Label>
                                <div className='w-3/4 p-2 bg-gray-100 rounded border border-gray-300'>
                                    {pageContext.current?.alignment_origin[1]}
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* ----------- */}
                    {/* Grid Layers */}
                    {/* ----------- */}
                    <div className='p-3 bg-white text-black rounded-md shadow-sm border border-gray-200'>
                        <div className='flex justify-between items-center mb-2'>
                            <h3 className='text-lg font-semibold'>Grid Level</h3>
                        </div>
                        {/* ---------- */}
                        {/* Grid Layer */}
                        {/* ---------- */}
                        <div className='space-y-3'>
                            {pageContext.current?.grid_info.map(([width, height], index) => (
                                <div key={index} className='p-2 bg-gray-50 rounded border border-gray-200'>
                                    <div className='flex justify-between items-center mb-2'>
                                        <h4 className='text-sm font-medium'>Level {index + 1}</h4>
                                    </div>
                                    <div className='grid grid-cols-2 gap-2'>
                                        <div>
                                            <label className='block text-xs mb-1'>Width/m</label>
                                            <input
                                                type='number'
                                                value={width ?? ''}
                                                readOnly={true}
                                                className='w-full px-2 py-1 text-sm border border-gray-300 rounded'
                                            />
                                        </div>
                                        <div>
                                            <label className='block text-xs mb-1'>Height/m</label>
                                            <input
                                                type='number'
                                                value={height ?? ''}
                                                readOnly={true}
                                                className='w-full px-2 py-1 text-sm border border-gray-300 rounded'
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div >
    )
}
