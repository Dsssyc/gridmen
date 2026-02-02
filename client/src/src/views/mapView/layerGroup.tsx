import { useState } from "react"
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers, Trash2, GripVertical, MapPin, Square, MapPinned, SquaresUnite, SplinePointer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/utils/utils"
import { useLayerStore, useLayerGroupStore, useToolPanelStore } from "@/store/storeSet"
import { ResourceTree } from "@/template/scene/scene"
import type { Layer } from "@/store/storeTypes"
import type { ResourceNode } from "@/template/scene/scene"
import { Switch } from "@/components/ui/switch"

interface LayerGroupProps {
    getResourceNodeByKey?: (key: string) => any | null
}

export default function LayerGroup({ getResourceNodeByKey }: LayerGroupProps) {

    const layers = useLayerStore((s) => s.layers)
    const setLayers = useLayerStore((s) => s.setLayers)
    const removeLayerNode = useLayerStore((s) => s.removeLayerNode)
    const clearLayerNodes = useLayerStore((s) => s.clearLayerNodes)
    const { isEditMode, setEditMode } = useLayerGroupStore()

    const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null)
    const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null)
    const [dropPosition, setDropPosition] = useState<'before' | 'after' | 'inside' | null>(null)
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["resource-node"]))

    const getResourceNodeGroup = (layersList: Layer[]) => {
        return layersList.find((l) => l.id === 'resource-node' && l.type === 'group') || null
    }

    const collectLayerNodes = (layerList: Layer[]): ResourceNode[] => {
        const nodes: ResourceNode[] = []
        const visit = (items: Layer[]) => {
            for (const item of items) {
                if (item.type === 'Layer' && item.node) {
                    nodes.push(item.node)
                }
                if (item.children && item.children.length > 0) {
                    visit(item.children)
                }
            }
        }
        visit(layerList)
        return nodes
    }

    const toggleExpanded = (id: string) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }

    const toggleVisibility = (id: string, parentId?: string) => {
        setLayers((prev) => {
            const updateLayer = (layers: Layer[]): Layer[] => {
                return layers.map((layer) => {

                    if (layer.id === id) {
                        return { ...layer, visible: !layer.visible }
                    }
                    if (layer.children) {
                        return { ...layer, children: updateLayer(layer.children) }
                    }
                    return layer
                })
            }
            return updateLayer(prev)
        })
    }

    const findAndRemoveLayer = (layers: Layer[], layerId: string): { layers: Layer[], removedLayer: Layer | null } => {
        let removedLayer: Layer | null = null
        const newLayers = layers.filter(layer => {
            if (layer.id === layerId) {
                removedLayer = layer
                return false
            }
            return true
        }).map(layer => {
            if (layer.children) {
                const result = findAndRemoveLayer(layer.children, layerId)
                if (result.removedLayer) {
                    removedLayer = result.removedLayer
                }
                return { ...layer, children: result.layers }
            }
            return layer
        })
        return { layers: newLayers, removedLayer }
    }

    const stripChildrenFromLeafLayer = (layer: Layer): Layer => {
        if (layer.type !== 'Layer') return layer
        const { children, ...rest } = layer
        return rest
    }

    const insertLayer = (layers: Layer[], targetId: string, newLayer: Layer, position: 'before' | 'after' | 'inside'): Layer[] => {
        const leafLayer = stripChildrenFromLeafLayer(newLayer)

        return layers
            .map(layer => {
                if (layer.id === targetId && position === 'inside' && layer.type === 'group') {
                    return {
                        ...layer,
                        children: [...(layer.children || []), leafLayer]
                    }
                }
                if (layer.children) {
                    return { ...layer, children: insertLayer(layer.children, targetId, leafLayer, position) }
                }
                return layer
            })
            .flatMap((layer) => {
                if (layer.id === targetId) {
                    if (position === 'before') {
                        return [leafLayer, layer]
                    } else if (position === 'after') {
                        return [layer, leafLayer]
                    }
                }
                return [layer]
            })
    }

    const triggerNodeCheck = (node: ResourceNode) => {
        const tree = node.tree as ResourceTree
        const handler = tree.getNodeMenuHandler()
        const { isEditMode } = useLayerGroupStore.getState()

        const menuItem = (() => {
            const action = isEditMode ? 'Edit' : 'Check'
            switch (node.template_name) {
                case 'schema':
                    return `${action} Schema`
                case 'patch':
                    return `${action} Patch`
                case 'vector':
                    return `${action} Vector`
                case 'grid':
                    return `${action} Grid`
                default:
                    return null
            }
        })()

        if (!menuItem) return
        handler(node, menuItem)
    }

    const handleLayerDragStart = (e: React.DragEvent, layerId: string) => {
        e.stopPropagation()
        setDraggedLayerId(layerId)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('application/layer-id', layerId)
    }

    const handleDrop = (e: React.DragEvent, targetLayerId: string) => {
        e.preventDefault()
        e.stopPropagation()

        const layerId = e.dataTransfer.getData('application/layer-id')

        const externalNodeKey = (() => {
            const raw = e.dataTransfer.getData('application/gridmen-node') || e.dataTransfer.getData('text/plain')
            if (raw) {
                const parsed = JSON.parse(raw)
                if (typeof parsed?.nodeKey === 'string') {
                    return parsed.nodeKey as string
                }
            }

            const nodeKey = e.dataTransfer.getData('application/gridmen-node-key')
            if (nodeKey) {
                return nodeKey as string
            }

            return null
        })()

        if (layerId && draggedLayerId) {
            if (layerId === targetLayerId) {
                setDragOverLayerId(null)
                setDraggedLayerId(null)
                setDropPosition(null)
                return
            }

            setLayers(prev => {
                const { layers: layersAfterRemove, removedLayer } = findAndRemoveLayer(prev, layerId)
                if (!removedLayer) return prev

                const position = dropPosition || 'after'
                const normalizedPosition = position === 'inside'
                    ? 'inside'
                    : position

                const newLayers = insertLayer(layersAfterRemove, targetLayerId, stripChildrenFromLeafLayer(removedLayer), normalizedPosition)
                return newLayers
            })

            if (dropPosition === 'inside') {
                setExpandedGroups(prev => new Set(prev).add(targetLayerId))
            }
        }
        else if (externalNodeKey) {
            const node = getResourceNodeByKey?.(externalNodeKey) as ResourceNode
            triggerNodeCheck(node)
            setExpandedGroups(prev => new Set(prev).add('resource-node'))
        }

        setDragOverLayerId(null)
        setDraggedLayerId(null)
        setDropPosition(null)
    }

    const handleDragOver = (e: React.DragEvent, layerId: string, isGroup: boolean) => {
        e.preventDefault()
        e.stopPropagation()

        const layerDragData = e.dataTransfer.types.includes('application/layer-id')
        const externalDragData = (
            e.dataTransfer.types.includes('text/plain') ||
            e.dataTransfer.types.includes('application/gridmen-node') ||
            e.dataTransfer.types.includes('application/gridmen-node-key')
        )

        if (layerDragData) {
            e.dataTransfer.dropEffect = 'move'
        } else if (externalDragData) {
            e.dataTransfer.dropEffect = 'copy'
        }

        setDragOverLayerId(layerId)

        const rect = e.currentTarget.getBoundingClientRect()
        const y = e.clientY - rect.top
        const height = rect.height

        if (isGroup) {
            setDropPosition('inside')
            return
        }

        if (y < height * 0.5) {
            setDropPosition('before')
        } else {
            setDropPosition('after')
        }
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOverLayerId(null)
        setDropPosition(null)
    }

    const handleDragEnd = () => {
        setDraggedLayerId(null)
        setDragOverLayerId(null)
        setDropPosition(null)
    }

    const handleDeleteLayer = (layer: Layer) => {
        const node = layer.node
        if (node) {
            const tree = node.tree as ResourceTree
            if (tree.selectedNode?.id === node.id) {
                tree.selectedNode = null
                tree.notifyDomUpdate()
                useToolPanelStore.getState().setActiveTab('create')
            }
        }

        setLayers(prev => {
            const { layers: nextLayers } = findAndRemoveLayer(prev, layer.id)
            return nextLayers
        })

        if (layer.node) {
            removeLayerNode(layer.node.key)
            layer.node.close().catch((err) => {
                console.warn('Failed to close layer node:', err)
            })
        }

        setExpandedGroups(prev => {
            if (!prev.has(layer.id)) return prev
            const next = new Set(prev)
            next.delete(layer.id)
            return next
        })
    }

    const handleRemoveAllLayers = () => {
        const resourceGroup = getResourceNodeGroup(layers)
        const nodesToClose = resourceGroup?.children ? collectLayerNodes(resourceGroup.children) : []

        nodesToClose.forEach((n) => {
            const tree = n.tree as ResourceTree
            if (tree.selectedNode?.id === n.id) {
                tree.selectedNode = null
                tree.notifyDomUpdate()
                useToolPanelStore.getState().setActiveTab('create')
            }

            n.close().catch((err) => {
                console.warn('Failed to close layer node:', err)
            })
        })

        setLayers((prev) =>
            prev.map((layer) => {
                if (layer.id !== 'resource-node' || layer.type !== 'group') {
                    return layer
                }
                return { ...layer, children: [] }
            })
        )
        clearLayerNodes()

        const { isEditMode } = useLayerGroupStore.getState()
        useToolPanelStore.getState().setActiveTab(isEditMode ? 'edit' : 'check')
    }

    const renderLayer = (layer: Layer, depth = 0) => {
        const isExpanded = expandedGroups.has(layer.id)
        const hasChildren = layer.children && layer.children.length > 0
        const isResourceNode = layer.name === "Resource Node"
        const isDragOver = dragOverLayerId === layer.id
        const isDragging = draggedLayerId === layer.id
        const isGroup = layer.type === "group"

        const getLayerIcon = (template?: string) => {
            switch (template) {
                case "schema":
                    return (layer.visible ? <MapPin className="w-4 h-4 text-red-500" /> : <MapPin className="w-4 h-4 text-gray-500" />)
                case 'patch':
                    return (layer.visible ? <Square className="w-4 h-4 text-sky-500" /> : <Square className="w-4 h-4 text-gray-500" />)
                case 'grid':
                    return (layer.visible ? <SquaresUnite className="w-4 h-4 text-amber-500" /> : <Square className="w-4 h-4 text-gray-500" />)
                case 'vector':
                    return (layer.visible ? <SplinePointer className="w-4 h-4 text-indigo-500" /> : <Square className="w-4 h-4 text-gray-500" />)
                default:
                    return <Layers className="w-4 h-4 text-gray-400" />
            }
        }

        return (
            <div key={layer.id} className="select-none relative">
                {/* Drop position indicator */}
                {isDragOver && dropPosition === 'before' && (
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-400 z-10" />
                )}
                {isDragOver && dropPosition === 'after' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400 z-10" />
                )}

                <div
                    draggable={!isResourceNode}
                    onDragStart={(e) => !isResourceNode && handleLayerDragStart(e, layer.id)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                        "group flex items-center gap-1 px-1.5 py-1 hover:bg-white/5 transition-colors relative cursor-pointer",
                        depth > 0 && "ml-4",
                        isDragOver && dropPosition === 'inside' && "bg-blue-500/20 border border-blue-400 border-dashed",
                        isDragging && "opacity-50"
                    )}
                    style={{ paddingLeft: `${depth * 16 + 8}px` }}
                    onDrop={(e) => handleDrop(e, layer.id)}
                    onDragOver={(e) => handleDragOver(e, layer.id, isGroup || isResourceNode)}
                    onDragLeave={handleDragLeave}
                    onClick={(e) => {
                        if (!isResourceNode && layer.node) {
                            e.stopPropagation()
                            triggerNodeCheck(layer.node)
                        }
                    }}
                >
                    {/* Expand/Collapse Icon */}
                    <div className="w-4 h-4 flex items-center justify-center">
                        <button onClick={() => toggleExpanded(layer.id)} className="hover:bg-white/10 rounded cursor-pointer">
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                        </button>
                    </div>

                    {/* Visibility Toggle */}
                    {/* <button
                        onClick={() => toggleVisibility(layer.id)}
                        className="w-5 h-5 flex items-center justify-center hover:bg-white/10 rounded cursor-pointer"
                    >
                        {layer.visible ? <Eye className="w-4 h-4 text-sky-500" /> : <EyeOff className="w-4 h-4 text-gray-500" />}
                    </button> */}

                    {/* Layer Icon */}
                    <div className="w-4 h-4 flex items-center justify-center">
                        {getLayerIcon(layer.template)}
                    </div>

                    {/* Layer Name */}
                    <span className={cn("flex-1 text-sm truncate", layer.visible ? "text-gray-200" : "text-gray-500")}>
                        {layer.name}
                    </span>

                    {/* Drag Handle */}
                    {!isResourceNode && layer.visible && (
                        <div className="flex opacity-0 group-hover:opacity-100 transition-opacity gap-1 mr-1">
                            {/* <MapPinned
                                className="w-4 h-4 text-gray-500 cursor-pointer hover:text-sky-500"
                                onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                }}
                            /> */}
                            <Trash2
                                className="w-4 h-4 text-gray-500 cursor-pointer hover:text-red-500"
                                onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleDeleteLayer(layer)
                                }}
                            />
                            <GripVertical className="w-4 h-4 text-gray-500 cursor-grab hover:text-gray-400 active:cursor-grabbing" />
                        </div>
                    )}
                </div>

                {/* Render Children */}
                {hasChildren && isExpanded && <div>{layer.children!.map((child) => renderLayer(child, depth + 1))}</div>}
            </div>
        )
    }

    const resourceGroup = getResourceNodeGroup(layers)
    const resourceLayerCount = resourceGroup?.children ? collectLayerNodes(resourceGroup.children).length : 0

    return (
        <div className="w-full h-full bg-[#1e1e1e] border-r border-gray-800 flex flex-col">
            {/* Header */}
            <div className="px-3 py-1.5 border-b border-[#2A2C33] flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-gray-400" />
                    <h2 className=" font-semibold text-gray-200">Layers</h2>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold text-gray-400">Check</span>
                    <Switch
                        checked={isEditMode}
                        onCheckedChange={setEditMode}
                        className='data-[state=checked]:bg-amber-400 h-4 data-[state=unchecked]:bg-gray-300 cursor-pointer'
                    />
                    <span className="text-sm font-semibold text-gray-400">Edit</span>
                </div>
            </div>

            {/* Toolbar */}
            <div className="px-2 h-8 border-b border-[#2A2C33] flex items-center justify-between gap-1">
                <Button
                    variant="ghost"
                    className="group h-6 w-1/2 px-2 text-xs rounded-sm hover:bg-white/10 cursor-pointer"
                >
                    <Eye className="w-4 h-4 text-gray-400 group-hover:text-sky-500" />
                    <span className="text-gray-400 group-hover:text-gray-200">Show All</span>
                </Button>
                <Button
                    variant="ghost"
                    className="group h-6 w-1/2 px-2 text-xs rounded-sm hover:bg-white/10 cursor-pointer"
                    onClick={handleRemoveAllLayers}
                // TODO: 清空Resource Node内图层
                >
                    <Trash2 className="w-4 h-4 text-gray-400 group-hover:text-red-500" />
                    <span className="text-gray-400 group-hover:text-gray-200">Remove</span>
                </Button>
            </div>

            {/* Layer List */}
            <ScrollArea className="flex-1">
                <div className="py-1">{layers.map((layer) => renderLayer(layer))}</div>
            </ScrollArea>

            {/* Footer Info */}
            <div className="px-3 py-2 border-t border-[#2A2C33] text-xs text-gray-500">
                <div className="flex justify-between">
                    <span>Total Layers: {resourceLayerCount}</span>
                    <span>CRS: EPSG:4326</span>
                </div>
            </div>
        </div>
    )
}
