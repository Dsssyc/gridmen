import { useMemo } from 'react'
import { MapViewContext } from './mapView'
import { IResourceNode } from '@/template/scene/iscene'
import { useToolPanelStore } from '@/store/storeSet'

interface NodeTemplateFunctionSet {
    check: Function | null
    create: Function | null
    edit: Function | null
}

interface ToolPanelProps {
    viewModels: {
        [templateName: string]: NodeTemplateFunctionSet
    } | null
    mapContainer: mapboxgl.Map | null
    drawInstance?: MapboxDraw | null
    templateName?: string
    selectedNode?: IResourceNode | null
}

export default function ToolPanel({
    viewModels,
    mapContainer,
    drawInstance = null,
    templateName = 'default',
    selectedNode = null
}: ToolPanelProps) {
    const activeTab = useToolPanelStore((s) => s.activeTab)

    const currentViewModel = viewModels?.[templateName] || viewModels?.['default'] || null

    const context: MapViewContext = useMemo(
        () => ({
            map: mapContainer,
            drawInstance,
            setMap: (map: mapboxgl.Map) => {
                console.log('setMap', map)
            },
            setDrawInstance: (drawInstance: MapboxDraw) => {
                console.log('setDrawInstance', drawInstance)
            },
        }),
        [mapContainer, drawInstance]
    )

    // Important: currentViewModel.{check,create,edit} returns a component function.
    // If we call it on every ToolPanel render, we create a new component type each time,
    // causing React to unmount/remount (triggering useEffect cleanups like unloadContext).
    const nodeArg = selectedNode || null

    const CheckComponent = useMemo(
        () => (currentViewModel?.check ? currentViewModel.check(nodeArg, context) : null),
        [currentViewModel, nodeArg, context]
    )
    const CreateComponent = useMemo(
        () => (currentViewModel?.create ? currentViewModel.create(nodeArg, context) : null),
        [currentViewModel, nodeArg, context]
    )
    const EditComponent = useMemo(
        () => (currentViewModel?.edit ? currentViewModel.edit(nodeArg, context) : null),
        [currentViewModel, nodeArg, context]
    )

    const ActiveComponent =
        activeTab === 'edit'
            ? (EditComponent || CreateComponent)
            : activeTab === 'check'
                ? (CheckComponent || CreateComponent)
                : CreateComponent

    if (!viewModels) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-800 text-white">
                No Tool Panel Available
            </div>
        )
    }

    if (!currentViewModel) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-800 text-white">
                No View Model Found for template: {templateName}
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full w-full bg-gray-900">
            {ActiveComponent ? <ActiveComponent /> : null}
        </div>
    )
}
