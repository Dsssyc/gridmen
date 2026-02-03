import { useState, useEffect, useRef, useCallback, useReducer } from 'react'
import {
    File,
    Plus,
    Check,
    Folder,
    MapPin,
    Square,
    FilePlusCorner,
    FolderOpen,
    FolderPlus,
    RefreshCcw,
    ChevronDown,
    ChevronRight,
    SquaresUnite,
    SplinePointer,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/utils/utils'
import { Button } from './ui/button'
import * as api from '@/template/api/apis'
import { Input } from '@/components/ui/input'
import { Separator } from "@/components/ui/separator"
import { ResourceNode, ResourceTree } from '@/template/scene/scene'
import { IResourceNode } from '@/template/scene/iscene'
import { useSelectedNodeStore, useToolPanelStore } from '@/store/storeSet'
import { RESOURCE_REGISTRY } from '@/registry/resourceRegistry'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"

interface NodeRendererProps {
    node: IResourceNode
    resourceTree: ResourceTree
    depth: number
    triggerFocus: number
    dragSourceTreeTitle?: string
    showNewResourceInfo?: boolean
    setShowNewResourceInfo?: (v: boolean) => void
    showNewFolderInput?: boolean
    setShowNewFolderInput?: (v: boolean) => void
}

interface TreeRendererProps {
    title: string
    resourceTree: ResourceTree | null
    triggerFocus: number
}

function CreationBar({ resourceTree, onCreated, onCancel }: { resourceTree: ResourceTree, onCreated?: () => void, onCancel?: () => void }) {
    const [localOpen, setLocalOpen] = useState(false)
    const [localValue, setLocalValue] = useState("")
    const [localNewResourceName, setLocalNewResourceName] = useState<string>('')
    const newResourceInputRefLocal = useRef<HTMLInputElement>(null)

    const { setSelectedNodeKey } = useSelectedNodeStore()

    const handleLocalPopoverOpenChange = (isOpen: boolean) => {
        setLocalOpen(isOpen)
        if (!isOpen && localNewResourceName && newResourceInputRefLocal.current) {
            setTimeout(() => {
                newResourceInputRefLocal.current?.focus()
            }, 0)
        }
    }

    const handleLocalCreate = async () => {
        if (localNewResourceName.trim() === '') {
            toast.error('Resource name cannot be empty')
            return
        }
        if (localValue === '') {
            toast.info('Please select new resource type.')
            return
        }
        try {
            const { selectedNodeKey } = useSelectedNodeStore.getState()
            let parentKey = selectedNodeKey ?? '.'

            const selectedNode = selectedNodeKey ? resourceTree.scene.get(selectedNodeKey) : null
            if (selectedNode && selectedNode.template_name !== 'default') {
                parentKey = selectedNode.parent?.key ?? '.'
            }

            const newNodeKey = parentKey === '.'
                ? `.${localNewResourceName}`
                : `${parentKey}.${localNewResourceName}`

            // TODO: 创建同名不同类型的Node
            if (resourceTree.scene.has(newNodeKey)) {
                toast.error('Node already exists')
                return
            }

            const createdNode = resourceTree.addLocalNode({
                node_key: newNodeKey,
                template_name: localValue,
                parent_key: parentKey,
            })

            setSelectedNodeKey(newNodeKey)
            setLocalNewResourceName('')
            onCreated && onCreated()
            useToolPanelStore.getState().setActiveTab('create')

            await resourceTree.clickNode(createdNode)
            resourceTree.tempNodeExist = true
        } catch (err) {
            console.error(err)
            toast.error('Failed to create new resource')
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleLocalCreate()
        } else if (e.key === 'Escape') {
            onCancel && onCancel()
        }
    }

    return (
        <div className={cn('flex items-center py-0.5 gap-0.5 text-sm w-full select-none')}>
            <Popover open={localOpen} onOpenChange={(isOpen) => handleLocalPopoverOpenChange(isOpen)}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={localOpen}
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                        className="h-6 w-6 text-black rounded-xs flex items-center justify-center cursor-pointer"
                    >
                        {(() => {
                            const selectedResource = RESOURCE_REGISTRY.find((resource) => resource.value === localValue)
                            if (!selectedResource) return <File className="w-4 h-4" />
                            const SelectedIcon = selectedResource.icon
                            return <SelectedIcon className="w-4 h-4" />
                        })()}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-36 p-0">
                    <Command>
                        <CommandInput placeholder="Search" className="h-6" />
                        <CommandList>
                            <CommandEmpty>No Resource found</CommandEmpty>
                            <CommandGroup>
                                {RESOURCE_REGISTRY.map((resource) => {
                                    const ResourceIcon = resource.icon
                                    return (
                                        <CommandItem
                                            key={resource.value}
                                            value={resource.value}
                                            onSelect={(currentValue) => {
                                                setLocalValue(currentValue === localValue ? "" : currentValue)
                                                setLocalOpen(false)
                                            }}
                                            className='cursor-pointer'
                                        >
                                            <ResourceIcon className="h-4 w-4" />
                                            {resource.label}
                                            <Check className={cn("ml-auto", localValue === resource.value ? "opacity-100" : "opacity-0")} />
                                        </CommandItem>
                                    )
                                })}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            <Input
                ref={newResourceInputRefLocal}
                value={localNewResourceName}
                onChange={e => setLocalNewResourceName(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={(e) => {
                    const relatedTarget = (e.relatedTarget as HTMLElement) || null
                    const isPopoverContent = relatedTarget?.closest('[data-slot="popover-content"]')
                    if (localOpen || isPopoverContent) return
                    onCancel && onCancel()
                }}
                className="h-6 text-sm rounded-xs bg-[#3C3C3C] border-gray-600"
                autoFocus
            />
        </div>
    )
}

function FolderCreationBar({ resourceTree, onCreated, onCancel }: { resourceTree: ResourceTree, onCreated?: () => void, onCancel?: () => void }) {
    const [localNewFolderName, setLocalNewFolderName] = useState<string>('')
    const newFolderInputRefLocal = useRef<HTMLInputElement>(null)

    const { setSelectedNodeKey } = useSelectedNodeStore()

    const handleLocalCreateFolder = async () => {
        if (localNewFolderName.trim() === '') {
            toast.error('Folder name cannot be empty')
            return
        }

        try {
            const { selectedNodeKey } = useSelectedNodeStore.getState()
            let parentKey = selectedNodeKey ?? '.'

            const selectedNode = selectedNodeKey ? resourceTree.scene.get(selectedNodeKey) : null
            if (selectedNode && selectedNode.template_name !== 'default') {
                parentKey = selectedNode.parent?.key ?? '.'
            }

            const newNodeKey = parentKey === '.'
                ? `.${localNewFolderName}`
                : `${parentKey}.${localNewFolderName}`

            if (resourceTree.scene.has(newNodeKey)) {
                toast.error('Folder already exists')
                return
            }

            await api.node.mountNode({
                nodeInfo: resourceTree.leadIP ? `${resourceTree.leadIP}::${newNodeKey}` : newNodeKey,
                templateName: '',
                mountParamsString: ''
            })

            setSelectedNodeKey(newNodeKey)
            setLocalNewFolderName('')
            onCreated && onCreated()

            await resourceTree.refresh()

            const createdNode = resourceTree.scene.get(newNodeKey)
            if (createdNode) {
                await resourceTree.clickNode(createdNode)
            }
        } catch (err) {
            console.error(err)
            toast.error('Failed to create new folder')
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleLocalCreateFolder()
        } else if (e.key === 'Escape') {
            onCancel && onCancel()
        }
    }

    return (
        <div className={cn('flex items-center py-0.5 px-2 text-sm w-full select-none')}>
            <div className='flex'>
                <Plus className='w-4 h-4 -ml-0.5 mr-0.5' />
                <Folder className='w-4 h-4 mr-2 text-gray-400' />
            </div>
            <Input
                ref={newFolderInputRefLocal}
                value={localNewFolderName}
                onChange={e => setLocalNewFolderName(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => onCancel && onCancel()}
                className="h-6 text-sm rounded-xs bg-[#3C3C3C] border-gray-600"
                autoFocus
            />
        </div>
    )
}

const NodeRenderer = ({
    node,
    resourceTree,
    depth,
    triggerFocus,
    dragSourceTreeTitle: sourceTreeTitle,
    showNewResourceInfo,
    setShowNewResourceInfo,
    showNewFolderInput,
    setShowNewFolderInput,
}: NodeRendererProps) => {

    const tree = node.tree as ResourceTree

    const isFolder = node.template_name === 'default'
    const isSelected = tree.selectedNode?.id === node.id

    const { setSelectedNodeKey } = useSelectedNodeStore()

    const nodeRef = useRef<HTMLDivElement>(null)
    const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const [isDragOver, setIsDragOver] = useState(false)

    const handleClickNode = useCallback((e: React.MouseEvent) => {
        if (!isFolder && !node.isTemp) return
        if (clickTimeoutRef.current) {
            clearTimeout(clickTimeoutRef.current)
            clickTimeoutRef.current = null
            return
        }

        if (node.isTemp) {
            useToolPanelStore.getState().setActiveTab('create')
        }

        // Always set selected key so UI highlights the clicked node
        setSelectedNodeKey(node.key)

        if (isFolder) {
            // For folders, delay click action to allow double-click detection
            clickTimeoutRef.current = setTimeout(() => {
                (node.tree as ResourceTree).clickNode(node)
                clickTimeoutRef.current = null
            }, 150)
        } else {
            // For files, immediately notify tree of click (select)
            ; (node.tree as ResourceTree).clickNode(node)
        }
    }, [node, isFolder, setSelectedNodeKey])


    // const handleDoubleClickNode = useCallback((e: React.MouseEvent) => {
    //     e.stopPropagation()

    //     // Clear single click timeout
    //     if (clickTimeoutRef.current) {
    //         clearTimeout(clickTimeoutRef.current)
    //         clickTimeoutRef.current = null
    //     }

    //     // Prevent text selection
    //     if (window.getSelection) {
    //         window.getSelection()?.removeAllRanges()
    //     }

    //     (node.tree as ResourceTree).doubleClickNode(node)
    // }, [node])

    const handleNodeMenu = useCallback((node: IResourceNode, menuItem: any) => {
        if (menuItem === 'New Resource' || menuItem === 'New Folder') {
            setSelectedNodeKey(node.key)
                ; (node.tree as ResourceTree).selectedNode = node

            if (menuItem === 'New Resource') {
                setShowNewFolderInput && setShowNewFolderInput(false)
                setShowNewResourceInfo && setShowNewResourceInfo(true)
                return
            }

            if (menuItem === 'New Folder') {
                setShowNewResourceInfo && setShowNewResourceInfo(false)
                setShowNewFolderInput && setShowNewFolderInput(true)
                return
            }
        }

        return (node.tree as ResourceTree).getNodeMenuHandler()(node, menuItem)
    }, [setSelectedNodeKey, setShowNewFolderInput, setShowNewResourceInfo])

    const renderNodeMenu = useCallback(() => {
        return node.template!.renderMenu(node, handleNodeMenu)
    }, [node, handleNodeMenu])

    const handleDragStart = useCallback((e: React.DragEvent) => {
        if (!isFolder) {
            const payload = {
                nodeKey: node.key,
                nodeInfo: node.nodeInfo,
                nodeLockId: (node as ResourceNode).lockId || null,
                templateName: node.template_name,
                sourceTreeTitle: sourceTreeTitle || ''
            }

            e.dataTransfer.setData('text/plain', JSON.stringify(payload))
            e.dataTransfer.setData('application/gridmen-node', JSON.stringify(payload))
            e.dataTransfer.setData('application/gridmen-node-key', node.key)
            e.dataTransfer.effectAllowed = 'copy'
        }
    }, [node, isFolder, sourceTreeTitle])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        if (isFolder) {
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'copy'
            setIsDragOver(true)
        } else {
            // 如果不是文件夹，允许事件继续冒泡到根目录
            // 不阻止传播，让根目录可以接收拖放
        }
    }, [isFolder])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        if (!isFolder) return

        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX
        const y = e.clientY

        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            setIsDragOver(false)
        }
    }, [isFolder])

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(false)

        if (!isFolder || !resourceTree) return

        try {
            const data = e.dataTransfer.getData('text/plain')
            if (!data) return

            const dragData = JSON.parse(data)
            const { nodeKey: sourceNodeKey, templateName, sourceTreeTitle: sourceTitle } = dragData
            const targetTitle = sourceTreeTitle || ''

            // 如果源节点是文件夹，不允许拖放
            if (templateName === 'default') {
                toast.error('Cannot drag folders')
                return
            }

            // 构建目标节点 key
            const targetNodeKey = node.key === '.'
                ? `.${sourceNodeKey.split('.').pop()}`
                : `${node.key}.${sourceNodeKey.split('.').pop()}`

            // 同一棵树内部
            if (sourceTitle === targetTitle) {
                if (targetTitle === 'Public') {
                    return
                } else if (targetTitle === 'WorkSpace') {
                    console.debug('TODO: handle private-to-private move', sourceNodeKey, targetNodeKey)
                    return
                }
            }

            // TODO (Dsssyc): how to get public address of source/target node?
            // private -> public
            if (sourceTitle === 'WorkSpace' && targetTitle === 'Public') {

                await api.node.pushNode({
                    template_name: templateName,
                    source_node_key: sourceNodeKey,
                    target_node_key: targetNodeKey
                })

                await resourceTree.refresh()
                toast.success(`Pushed node to ${node.name}`)

                return
            }

            // public -> private
            if (sourceTitle === 'Public' && targetTitle === 'WorkSpace') {

                await api.node.pullNode({
                    template_name: templateName,
                    source_node_key: sourceNodeKey,
                    target_node_key: targetNodeKey,
                })

                await resourceTree.refresh()
                toast.success(`Pulled node to ${node.name}`)

                return
            }

            await resourceTree.refresh()
            toast.success(`Node added to ${node.name}`)
        } catch (error) {
            console.error('Drop error:', error)
            toast.error('Failed to add node')
        }
    }, [isFolder, resourceTree, node.key, node.name, sourceTreeTitle])

    useEffect(() => {
        if (isSelected && nodeRef.current) {
            nodeRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            })
        }
    }, [isSelected, triggerFocus])

    useEffect(() => {
        return () => {
            if (clickTimeoutRef.current) {
                clearTimeout(clickTimeoutRef.current)
            }
        }
    }, [])

    return (
        <div>
            <ContextMenu>
                <ContextMenuTrigger>
                    <div
                        ref={nodeRef}
                        className={cn(
                            'flex items-center py-0.5 px-2 hover:bg-gray-700 cursor-pointer text-sm w-full select-none',
                            isSelected ? 'bg-gray-600 text-white' : 'text-gray-300',
                            isFolder && isDragOver && 'bg-gray-500/50',
                        )}
                        data-node-type={isFolder ? 'folder' : 'file'}
                        style={{ paddingLeft: `${depth * 10}px` }}
                        onClick={handleClickNode}
                        // onDoubleClick={handleDoubleClickNode}
                        draggable={!isFolder}
                        onDragStart={(e) => { handleDragStart(e) }}
                        onDragOver={(e) => { handleDragOver(e) }}
                        onDragLeave={(e) => { handleDragLeave(e) }}
                        onDrop={(e) => { handleDrop(e) }}
                    >
                        <div className='ml-1.5 flex'>
                            {isFolder ? (
                                <>
                                    {tree.isNodeExpanded(node.id) ? (
                                        <>
                                            <ChevronDown className='w-4 h-4 mr-0.5' />
                                            <FolderOpen className='w-4 h-4 mr-1 text-gray-400' />
                                        </>
                                    ) : (
                                        <>
                                            <ChevronRight className='w-4 h-4 mr-0.5' />
                                            <Folder className='w-4 h-4 mr-1 text-gray-400' />
                                        </>
                                    )}
                                </>
                            ) : (
                                (() => {
                                    switch (node.template_name) {
                                        case 'schema':
                                            return <MapPin className={cn(node.isTemp ? 'text-white' : 'text-red-500', 'w-4 h-4 mr-1 ml-4.5 ')} />
                                        case 'patch':
                                            return <Square className={cn(node.isTemp ? 'text-white' : 'text-sky-500', 'w-4 h-4 mr-1 ml-4.5 ')} />
                                        case 'grid':
                                            return <SquaresUnite className={cn(node.isTemp ? 'text-white' : 'text-amber-500', 'w-4 h-4 mr-1 ml-4.5 ')} />
                                        case 'vector':
                                            return <SplinePointer className={cn(node.isTemp ? 'text-white' : 'text-indigo-500', 'w-4 h-4 mr-1 ml-4.5 ')} />
                                        default:
                                            return <File className='w-4 h-4 mr-2 ml-4.5 text-blue-500' />
                                    }
                                })()
                            )}
                        </div>
                        <span className={cn(node.isTemp && 'italic')}>{node.name}</span>
                        {node.isTemp && <span className='ml-2 text-xs font-semibold text-yellow-500'>[temp]</span>}
                    </div>
                </ContextMenuTrigger>
                {renderNodeMenu()}
            </ContextMenu>

            {/* If this node is the focused node and creation bar requested, render CreationBar with same indent */}
            {showNewResourceInfo && resourceTree && resourceTree.selectedNode && resourceTree.selectedNode.id === node.id && setShowNewResourceInfo && (
                <div style={{ paddingLeft: `${depth * 10}px` }}>
                    <CreationBar resourceTree={resourceTree} onCreated={() => setShowNewResourceInfo(false)} onCancel={() => setShowNewResourceInfo(false)} />
                </div>
            )}

            {showNewFolderInput && resourceTree && resourceTree.selectedNode && resourceTree.selectedNode.id === node.id && setShowNewFolderInput && (
                <div style={{ paddingLeft: `${depth * 10}px` }}>
                    <FolderCreationBar resourceTree={resourceTree} onCreated={() => setShowNewFolderInput(false)} onCancel={() => setShowNewFolderInput(false)} />
                </div>
            )}

            {/* Render child nodes */}
            {isFolder && tree.isNodeExpanded(node.id) && node.children && (
                <div>
                    {Array.from(node.children.values()).map(childNode => (
                        <NodeRenderer
                            key={childNode.id}
                            node={childNode}
                            resourceTree={resourceTree}
                            depth={depth + 1}
                            triggerFocus={triggerFocus}
                            dragSourceTreeTitle={sourceTreeTitle}
                            showNewResourceInfo={showNewResourceInfo}
                            setShowNewResourceInfo={setShowNewResourceInfo}
                            showNewFolderInput={showNewFolderInput}
                            setShowNewFolderInput={setShowNewFolderInput}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

const TreeRenderer = ({ title, resourceTree, triggerFocus }: TreeRendererProps) => {

    const [showNewResourceInfo, setShowNewResourceInfo] = useState<boolean>(false)
    const [showNewFolderInput, setShowNewFolderInput] = useState<boolean>(false)

    const { setSelectedNodeKey } = useSelectedNodeStore()

    const handleClickTreeTitle = () => {
        if (resourceTree) {
            resourceTree.selectedNode = null
        }
        setSelectedNodeKey('.')
    }

    const handleFilePlusClick = (e: React.MouseEvent) => {
        if (resourceTree && resourceTree.tempNodeExist === true) {
            toast.error('Please delete the previously created temporary node or complete the formal creation of the node.')
            return
        }
        e.stopPropagation()
        e.preventDefault()
        setShowNewResourceInfo(true)
        setShowNewFolderInput(false)
    }

    const handleFolderPlusClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        setShowNewFolderInput(true)
        setShowNewResourceInfo(false)
    }

    const handleRefreshClick = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (resourceTree) {
            await resourceTree.refresh()
        }
    }

    const handleRootDragOver = (e: React.DragEvent) => {
        // 允许在根目录放置，但不显示高亮
        // 检查是否拖拽到了子节点（文件夹），如果是则不处理，让子节点处理
        const target = e.target as HTMLElement
        const isDraggingOverChild = target.closest('[data-node-type="folder"]')

        if (!isDraggingOverChild) {
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'copy'
        }
    }

    const handleRootDrop = async (e: React.DragEvent) => {
        // 如果拖放到了子节点（文件夹），让子节点处理
        const target = e.target as HTMLElement
        const isDroppingOnChild = target.closest('[data-node-type="folder"]')
        if (isDroppingOnChild) {
            return
        }

        e.preventDefault()
        e.stopPropagation()

        if (!resourceTree) return

        try {
            const data = e.dataTransfer.getData('text/plain')
            if (!data) return

            const dragData = JSON.parse(data)
            const { nodeKey: sourceNodeKey, templateName, sourceTreeTitle: sourceTitle } = dragData

            if (templateName === 'default') {
                toast.error('Cannot drag folders')
                return
            }

            // 构建目标节点 key（添加到根目录）
            const targetNodeKey = `.${sourceNodeKey.split('.').pop()}`

            // 同一棵树内部
            if (sourceTitle === title) {
                if (title === 'Public') {
                    // Public 内部禁止
                    return
                } else if (title === 'WorkSpace') {
                    // Private 内部：预留逻辑占位
                    console.debug('TODO: handle private-to-private move at root', sourceNodeKey, targetNodeKey)
                    return
                }
            }

            // private -> public
            if (sourceTitle === 'WorkSpace' && title === 'Public') {
                await api.node.pushNode({
                    template_name: templateName,
                    source_node_key: sourceNodeKey,
                    target_node_key: targetNodeKey
                })
                await resourceTree.refresh()
                toast.success(`Pushed node to ${title}`)
                return
            }

            // public -> private
            if (sourceTitle === 'Public' && title === 'WorkSpace') {
                await api.node.pullNode({
                    template_name: templateName,
                    source_node_key: sourceNodeKey,
                    target_node_key: targetNodeKey
                })
                await resourceTree.refresh()
                toast.success(`Pulled node to ${title}`)
                return
            }

            await resourceTree.refresh()
            toast.success(`Node added to ${title}`)
        } catch (error) {
            console.error('Drop error:', error)
            toast.error('Failed to add node')
        }
    }

    return (
        <div
            className='flex flex-col flex-1 min-h-0'
            onDragOver={handleRootDragOver}
            onDrop={handleRootDrop}
        >
            <div
                className='z-10 h-8 bg-[#2A2C33] py-1 pl-1 text-sm font-semibold flex items-center text-gray-200 cursor-pointer'
                onClick={handleClickTreeTitle}
            >
                <span className='ml-2 hover:[text-shadow:0_0_10px_rgba(255,255,255,0.5)]'>{title}</span>
                <div className='ml-auto mr-2'>
                    {title === 'WorkSpace' && (
                        <>
                            <Button
                                className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'
                                onClick={(e) => handleFilePlusClick(e)}
                            >
                                <FilePlusCorner className='w-4 h-4' />
                            </Button>
                            <Button
                                className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'
                                onClick={(e) => handleFolderPlusClick(e)}
                            >
                                <FolderPlus className='w-4 h-4' />
                            </Button>
                        </>
                    )}
                    <Button
                        className='w-6 h-6 rounded-sm bg-[#2A2C33] hover:bg-[#363737] text-[#B8B8B8] cursor-pointer'
                        onClick={(e) => handleRefreshClick(e)}
                    >
                        <RefreshCcw className='w-4 h-4' />
                    </Button>
                </div>
            </div>
            <div className='flex-1 min-h-0 overflow-y-auto scrollbar-hover'>
                {showNewResourceInfo && resourceTree && !resourceTree.selectedNode && (
                    <div style={{ paddingLeft: `0px` }}>
                        <CreationBar resourceTree={resourceTree} onCreated={() => setShowNewResourceInfo(false)} onCancel={() => setShowNewResourceInfo(false)} />
                    </div>
                )}

                {showNewFolderInput && resourceTree && !resourceTree.selectedNode && (
                    <div style={{ paddingLeft: `0px` }}>
                        <FolderCreationBar resourceTree={resourceTree} onCreated={() => setShowNewFolderInput(false)} onCancel={() => setShowNewFolderInput(false)} />
                    </div>
                )}
                {resourceTree && resourceTree.root.children && Array.from(resourceTree.root.children.values()).map(childNode => (
                    <NodeRenderer
                        key={childNode.id}
                        node={childNode}
                        resourceTree={resourceTree}
                        depth={0}
                        triggerFocus={triggerFocus}
                        dragSourceTreeTitle={title}
                        showNewResourceInfo={showNewResourceInfo}
                        setShowNewResourceInfo={setShowNewResourceInfo}
                        showNewFolderInput={showNewFolderInput}
                        setShowNewFolderInput={setShowNewFolderInput}
                    />
                ))}
            </div>

        </div>
    )
}

interface ResourceTreeComponentProps {
    privateTree: ResourceTree | null
    publicTree: ResourceTree | null
    focusNode: IResourceNode | null
    triggerFocus: number
    onNodeMenuOpen: (node: IResourceNode, menuItem: any) => void
    onNodeRemove: (node: IResourceNode) => void
    onNodeClick: (node: IResourceNode) => void
    onNodeDoubleClick: (node: IResourceNode) => void
}

export default function ResourceTreeComponent({
    privateTree,
    publicTree,
    focusNode,
    triggerFocus,
    onNodeMenuOpen,
    onNodeRemove,
    onNodeClick,
    onNodeDoubleClick
}: ResourceTreeComponentProps) {

    const [, triggerRepaint] = useReducer(x => x + 1, 0)
    const { setSelectedNodeKey } = useSelectedNodeStore()

    const handleNodeRemoveWithTempReset = useCallback((node: IResourceNode) => {
        if (node?.isTemp) {
            const { selectedNodeKey } = useSelectedNodeStore.getState()
            if (selectedNodeKey === node.key) {
                setSelectedNodeKey('.')
            }
        }
        onNodeRemove(node)
    }, [onNodeRemove, setSelectedNodeKey])

    useEffect(() => {
        if (privateTree) {
            privateTree.bindHandlers({
                onNodeMenuOpen: onNodeMenuOpen,
                onNodeRemove: handleNodeRemoveWithTempReset,
                onNodeClick: onNodeClick,
                onNodeDoubleClick: onNodeDoubleClick
            })

            const unsubscribe = privateTree.subscribe(triggerRepaint)
            return () => {
                unsubscribe()
            }
        }
    }, [privateTree, onNodeMenuOpen, handleNodeRemoveWithTempReset, onNodeClick, onNodeDoubleClick])

    useEffect(() => {
        if (publicTree) {
            publicTree.bindHandlers({
                onNodeMenuOpen: onNodeMenuOpen,
                onNodeRemove: handleNodeRemoveWithTempReset,
                onNodeClick: onNodeClick,
                onNodeDoubleClick: onNodeDoubleClick
            })

            const unsubscribe = publicTree.subscribe(triggerRepaint)
            return () => {
                unsubscribe()
            }
        }
    }, [publicTree, onNodeMenuOpen, handleNodeRemoveWithTempReset, onNodeClick, onNodeDoubleClick])

    useEffect(() => {
        if (focusNode) {
            const tree = focusNode.tree as ResourceTree
            const expand = async () => {
                const success = await tree.expandNode(focusNode)
                if (success) triggerRepaint()
            }
            expand()
        }
    }, [focusNode, triggerFocus])

    return (
        <div className="flex h-full bg-[#252526]">
            <div className="w-full h-full flex flex-col min-h-0">
                <div className='text-sm font-semibold text-gray-400 py-2 ml-2 tracking-wide'>
                    EXPLORER
                </div>
                {/* WorkSpace */}
                <div className="flex-1 min-h-0 flex flex-col">
                    <TreeRenderer resourceTree={privateTree} title={"WorkSpace"} triggerFocus={triggerFocus} />
                    {/* <Separator className='bg-[#585858] w-full shrink-0' />
                    <TreeRenderer resourceTree={publicTree} title={"Public"} triggerFocus={triggerFocus} /> */}
                </div>
            </div>
        </div>
    )
}
