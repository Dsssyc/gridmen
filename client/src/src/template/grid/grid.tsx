import { toast } from "sonner"
import GridEdit from "./gridEdit"
import * as api from '../api/apis'
import GridCheck from "./gridCheck"
import { ITemplate } from "../iTemplate"
import GridCreation from "./gridCreation"
import { exportGridTopo } from "../api/grid"
import { IResourceNode } from "../scene/iscene"
import { IViewContext } from "@/views/IViewContext"
import { ResourceNode, ResourceTree } from "../scene/scene"
import { useLayerStore, useToolPanelStore } from "@/store/storeSet"
import { CopyPlus, Delete, Edit3, FilePlusCorner, Info } from "lucide-react"
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'

enum GridMenuItem {
    CREATE_GRID = 'Create Grid',
    CHECK_GRID = 'Check Grid',
    EDIT_GRID = 'Edit Grid',
    EXPORT_GRID = 'Export Grid',
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

                {(node as ResourceNode).tree.leadIP === undefined && (
                    <>
                        {!node.isTemp && (
                            <>
                                <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, GridMenuItem.EDIT_GRID) }}>
                                    <Edit3 className='w-4 h-4' />
                                    <span>Edit</span>
                                </ContextMenuItem>
                                <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, GridMenuItem.EXPORT_GRID) }}>
                                    <CopyPlus className='w-4 h-4' />
                                    <span>Export</span>
                                </ContextMenuItem>
                            </>
                        )}

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
            case GridMenuItem.EXPORT_GRID: {

                const api = window.electronAPI
                if (!api?.openFolderDialog) {
                    toast.error('Electron folder dialog not available')
                    return
                }

                const selectedPath = await api.openFolderDialog()
                if (!selectedPath) return

                // const exportPatch = {
                //     nodeInfo: node.nodeInfo,
                //     exportPath: selectedPath
                // }

                const exportResult = await exportGridTopo(node.nodeInfo, selectedPath)
                if (exportResult.success) {
                    toast.success(`Successed export grid to ${selectedPath}`)
                } else {
                    toast.error(`Failed to export grid: ${exportResult.message}`)
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