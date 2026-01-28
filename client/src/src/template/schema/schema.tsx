import { toast } from 'sonner'
import * as api from '../api/apis'
import SchemaEdit from "./schemaEdit"
import SchemaCheck from "./schemaCheck"
import { ITemplate } from "../iTemplate"
import SchemaCreation from "./schemaCreation"
import { IResourceNode } from "../scene/iscene"
import { useLayerStore, useSelectedNodeStore, useToolPanelStore } from '@/store/storeSet'
import { IViewContext } from "@/views/IViewContext"
import { ResourceNode, ResourceTree } from "../scene/scene"
import { Delete, Edit3, FilePlusCorner, Info } from "lucide-react"
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { linkNode } from '../api/node'
import store from '@/store/store'

enum SchemaMenuItem {
    CREATE_SCHEMA = 'Create Schema',
    CHECK_SCHEMA = 'Check Schema',
    EDIT_SCHEMA = 'Edit Schema',
    DELETE_SCHEMA = 'Delete Schema',
}

export default class SchemaTemplate implements ITemplate {
    static templateName: string = 'schema'
    templateName: string = SchemaTemplate.templateName

    viewModels = {
        'MapView': {
            check: SchemaTemplate.checkMapView,
            create: SchemaTemplate.creationMapView,
            edit: SchemaTemplate.editMapView
        }
    }

    static checkMapView(node: IResourceNode, context: IViewContext): Function {
        return () => SchemaCheck({ node, context })
    }
    static creationMapView(node: IResourceNode, context: IViewContext): Function {
        return () => SchemaCreation({ node, context })
    }
    static editMapView(node: IResourceNode, context: IViewContext): Function {
        return () => SchemaEdit({ node, context })
    }

    renderMenu(node: IResourceNode, handleContextMenu: (node: IResourceNode, menuItem: any) => void): React.JSX.Element {
        return (
            <ContextMenuContent>
                {node.isTemp && (<ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, SchemaMenuItem.CREATE_SCHEMA) }}>
                    <FilePlusCorner className='w-4 h-4' />
                    <span>Create</span>
                </ContextMenuItem>)}
                {!node.isTemp && (<ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, SchemaMenuItem.CHECK_SCHEMA) }}>
                    <Info className='w-4 h-4' />
                    <span>Check</span>
                </ContextMenuItem>)}
                {(node as ResourceNode).tree.leadIP === undefined && (
                    <>
                        {!node.isTemp && (
                            <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, SchemaMenuItem.EDIT_SCHEMA) }}>
                                <Edit3 className='w-4 h-4' />
                                <span>Edit</span>
                            </ContextMenuItem>
                        )}
                        <ContextMenuItem className='cursor-pointer flex bg-red-500 hover:!bg-red-600' onSelect={() => { handleContextMenu(node, SchemaMenuItem.DELETE_SCHEMA) }}>
                            <Delete className='w-4 h-4 text-white rotate-180' />
                            <span className='text-white'>Delete</span>
                        </ContextMenuItem>
                    </>
                )}
            </ContextMenuContent>
        )
    }

    async handleMenuOpen(node: IResourceNode, menuItem: any): Promise<void> {
        console.log('SchemaTemplate handleMenuOpen', menuItem)
        switch (menuItem) {
            case SchemaMenuItem.CREATE_SCHEMA:
                useToolPanelStore.getState().setActiveTab('create')
                break
            case SchemaMenuItem.CHECK_SCHEMA: {
                if (!(node as ResourceNode).lockId) {
                    store.get<{ on: Function, off: Function }>('isLoading')!.on()
                    const linkResponse = await linkNode('gridmen/ISchema/1.0.0', node.nodeInfo, 'r');
                    (node as ResourceNode).lockId = linkResponse.lock_id
                    store.get<{ on: Function, off: Function }>('isLoading')!.off()
                }
                if ((node as ResourceNode).mountParams === undefined) {
                    const schemaNode = await api.node.getNodeParams(node.nodeInfo)
                    const parsed = JSON.parse((schemaNode as any).mount_params);
                    (node as ResourceNode).mountParams = parsed
                    useLayerStore.getState().addNodeToLayerGroup(node as ResourceNode)
                } else {
                    useLayerStore.getState().addNodeToLayerGroup(node as ResourceNode)
                }
            }
                break
            case SchemaMenuItem.EDIT_SCHEMA: {
                if (!(node as ResourceNode).lockId) {
                    store.get<{ on: Function, off: Function }>('isLoading')!.on()
                    const linkResponse = await linkNode('gridmen/ISchema/1.0.0', node.nodeInfo, 'r');
                    (node as ResourceNode).lockId = linkResponse.lock_id
                    store.get<{ on: Function, off: Function }>('isLoading')!.off()
                }
                if ((node as ResourceNode).mountParams === undefined) {
                    const schemaNode = await api.node.getNodeParams(node.nodeInfo)
                    const parsed = JSON.parse((schemaNode as unknown as any).mount_params);
                    (node as ResourceNode).mountParams = parsed
                    useLayerStore.getState().addNodeToLayerGroup(node as ResourceNode)
                } else {
                    useLayerStore.getState().addNodeToLayerGroup(node as ResourceNode)
                }
            }
                break
            case SchemaMenuItem.DELETE_SCHEMA:
                {
                    if (node.isTemp) {
                        (node as ResourceNode).tree.tempNodeExist = false
                        await (node.tree as ResourceTree).removeNode(node)
                        useSelectedNodeStore.getState().setSelectedNodeKey('.')
                        await (node as ResourceNode).close()
                        toast.success(`Schema ${node.name} deleted successfully`)
                        return
                    }

                    await api.node.unmountNode(node.nodeInfo)
                    toast.success(`Schema ${node.name} deleted successfully`)
                    useSelectedNodeStore.getState().setSelectedNodeKey('.')
                    await (node.tree as ResourceTree).refresh()
                }
                break
        }
    }
}

