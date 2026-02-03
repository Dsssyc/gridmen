import DefaultTemplate from "../default/default"
import * as api from '../api/apis'
import { IResourceNode } from "../scene/iscene"
import { IViewContext } from "@/views/IViewContext"
import GridCheck from "./gridCheck"
import GridCreation from "./gridCreation"
import GridEdit from "./gridEdit"
import { ITemplate } from "../iTemplate"
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { CopyPlus, Delete, Edit3, FilePlusCorner, Info } from "lucide-react"
import { ResourceNode, ResourceTree } from "../scene/scene"
import { toast } from "sonner"
import { useLayerStore, useToolPanelStore } from "@/store/storeSet"
import { exportGridTopo } from "../api/grid"

enum GridMenuItem {
    CREATE_GRID = 'Create Grid',
    CHECK_GRID = 'Check Grid',
    EDIT_GRID = 'Edit Grid',
    Export_GRID = 'Export Grid',
    DELETE_GRID = 'Delete Grid',
}


export default class GridTemplate implements ITemplate {
    static templateName: string = 'grid'
    templateName: string = GridTemplate.templateName

    static viewModels = {
        'MapView': {
            check: GridTemplate.checkMapView,
            create: GridTemplate.creationMapView,
            edit: GridTemplate.editMapView
        }
    }

    static checkMapView(node: IResourceNode, context: IViewContext): Function {
        return () => GridCheck()
    }
    static creationMapView(node: IResourceNode, context: IViewContext): Function {
        return () => GridCreation({ node, context })
    }
    static editMapView(node: IResourceNode, context: IViewContext): Function {
        return () => GridEdit()
    }

    renderMenu(node: IResourceNode, handleContextMenu: (node: IResourceNode, menuItem: any) => void): React.JSX.Element {
        return (
            <ContextMenuContent>
                {node.isTemp && (<ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, GridMenuItem.CREATE_GRID) }}>
                    <FilePlusCorner className='w-4 h-4' />
                    <span>Create</span>
                </ContextMenuItem>)}
                {!node.isTemp && (<ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, GridMenuItem.CHECK_GRID) }}>
                    <Info className='w-4 h-4' />
                    <span>Check</span>
                </ContextMenuItem>)}
                {!node.isTemp && (<ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, GridMenuItem.Export_GRID) }}>
                    <CopyPlus className='w-4 h-4' />
                    <span>Export</span>
                </ContextMenuItem>)}

                {(node as ResourceNode).tree.leadIP === undefined && (
                    <>
                        {!node.isTemp && (
                            <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, GridMenuItem.EDIT_GRID) }}>
                                <Edit3 className='w-4 h-4' />
                                <span>Edit</span>
                            </ContextMenuItem>)}

                        < ContextMenuItem className='cursor-pointer flex bg-red-500 hover:!bg-red-600' onSelect={() => { handleContextMenu(node, GridMenuItem.DELETE_GRID) }}>
                            <Delete className='w-4 h-4 text-white rotate-180' />
                            <span className='text-white' >Delete</span>
                        </ContextMenuItem>
                    </>
                )}
            </ContextMenuContent>
        )
    }

    async handleMenuOpen(node: IResourceNode, menuItem: any): Promise<void> {
        switch (menuItem) {
            case GridMenuItem.CREATE_GRID:
                useToolPanelStore.getState().setActiveTab('create')
                break
            case GridMenuItem.CHECK_GRID: {
                const gridInfo = await api.node.getNodeParams(node.nodeInfo)
                    ; (node as ResourceNode).mountParams = gridInfo
                useLayerStore.getState().addNodeToLayerGroup(node as ResourceNode)
            }
                break
            case GridMenuItem.EDIT_GRID: {
                const gridInfo = await api.node.getNodeParams(node.nodeInfo)
                    ; (node as ResourceNode).mountParams = gridInfo
                useLayerStore.getState().addNodeToLayerGroup(node as ResourceNode)
            }
                break
            case GridMenuItem.Export_GRID: {
                const filePath = await window.electronAPI!.openFolderDialog()
                if (!filePath) {
                    toast.error('Failed to select export folder')
                    return
                }
                const exportInfo = await exportGridTopo(node.nodeInfo, filePath)

                if (exportInfo.success) {
                    toast.success('Grid topology exported successfully')
                } else {
                    toast.error(`Failed to export grid topology: ${exportInfo.message}`)
                }
            }
                break
            case GridMenuItem.DELETE_GRID:
                {
                    if (node.isTemp) {
                        ; (node as ResourceNode).tree.tempNodeExist = false
                        await (node.tree as ResourceTree).removeNode(node)
                        await (node as ResourceNode).close()
                        toast.success(`Grid ${node.name} deleted successfully`)
                        return
                    }

                    await api.node.unmountNode(node.nodeInfo)
                    toast.success(`Grid ${node.name} deleted successfully`)
                    await (node.tree as ResourceTree).refresh()
                }
                break
        }
    }
}