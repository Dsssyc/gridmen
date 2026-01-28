import { IViewContext } from "@/views/IViewContext";
import { ITemplate } from "../iTemplate";
import { IResourceNode } from "../scene/iscene"
import VectorCheck from "./vectorCheck";
import VectorCreation from "./vectorCreation";
import VectorEdit from "./vectorEdit"
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { Delete, Edit3, FilePlusCorner, Info } from "lucide-react";
import { ResourceNode, ResourceTree } from "../scene/scene";
import { useLayerStore, useSelectedNodeStore, useToolPanelStore } from "@/store/storeSet"
import * as api from '../api/apis'
import { linkNode } from "../api/node";
import { toast } from "sonner";

enum VectorMenuItem {
    CREATE_VECTOR = 'Create Vector',
    CHECK_VECTOR = 'Check Vector',
    EDIT_VECTOR = 'Edit Vector',
    DELETE_VECTOR = 'Delete Vector',
}

export default class VectorTemplate implements ITemplate {
    static templateName: string = 'vector'
    templateName: string = VectorTemplate.templateName

    static viewModels = {
        'MapView': {
            check: VectorTemplate.checkMapView,
            create: VectorTemplate.creationMapView,
            edit: VectorTemplate.editMapView
        }
    }

    static checkMapView(node: IResourceNode, context: IViewContext): Function {
        return () => VectorCheck({ node, context })
    }

    static creationMapView(node: IResourceNode, context: IViewContext): Function {
        return () => VectorCreation({ node, context })
    }

    static editMapView(node: IResourceNode, context: IViewContext): Function {
        return () => VectorEdit({ node, context })
    }

    renderMenu(node: IResourceNode, handleContextMenu: (node: IResourceNode, menuItem: any) => void): React.JSX.Element {
        return (
            <ContextMenuContent>
                {node.isTemp && (<ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, VectorMenuItem.CREATE_VECTOR) }}>
                    <FilePlusCorner className='w-4 h-4' />
                    <span>Create</span>
                </ContextMenuItem>)}
                {!node.isTemp && (<ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, VectorMenuItem.CHECK_VECTOR) }}>
                    <Info className='w-4 h-4' />
                    <span>Check</span>
                </ContextMenuItem>)}

                {(node as ResourceNode).tree.leadIP === undefined && (
                    <>
                        {!node.isTemp && (
                            <ContextMenuItem className='cursor-pointer' onSelect={() => { handleContextMenu(node, VectorMenuItem.EDIT_VECTOR) }}>
                                <Edit3 className='w-4 h-4' />
                                <span>Edit</span>
                            </ContextMenuItem>)}

                        < ContextMenuItem className='cursor-pointer flex bg-red-500 hover:!bg-red-600' onSelect={() => { handleContextMenu(node, VectorMenuItem.DELETE_VECTOR) }}>
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
            case VectorMenuItem.CREATE_VECTOR:
                useToolPanelStore.getState().setActiveTab('create')
                break
            case VectorMenuItem.CHECK_VECTOR: {
                if (!(node as ResourceNode).lockId) {
                    const linkResponse = await linkNode('gridmen/IVector/1.0.0', node.nodeInfo, 'r');
                    (node as ResourceNode).lockId = linkResponse.lock_id
                }
                const vectorInfo = await api.vector.getVector(node.nodeInfo, (node as ResourceNode).lockId!);
                (node as ResourceNode).mountParams = vectorInfo
                useLayerStore.getState().addNodeToLayerGroup(node as ResourceNode)
            }
                break
            case VectorMenuItem.EDIT_VECTOR: {
                if (!(node as ResourceNode).lockId) {
                    const linkResponse = await linkNode('gridmen/IVector/1.0.0', node.nodeInfo, 'w');
                    (node as ResourceNode).lockId = linkResponse.lock_id
                }
                const vectorInfo = await api.vector.getVector(node.nodeInfo, (node as ResourceNode).lockId!);
                (node as ResourceNode).mountParams = vectorInfo
                useLayerStore.getState().addNodeToLayerGroup(node as ResourceNode)
            }
                break
            case VectorMenuItem.DELETE_VECTOR:
                {
                    if (node.isTemp) {
                        ; (node as ResourceNode).tree.tempNodeExist = false
                        await (node.tree as ResourceTree).removeNode(node)
                        useSelectedNodeStore.getState().setSelectedNodeKey('.')
                        await (node as ResourceNode).close()
                        toast.success(`Vector ${node.name} deleted successfully`)
                        return
                    }

                    await api.node.unmountNode(node.key)
                    toast.success(`Vector ${node.name} deleted successfully`)
                    useSelectedNodeStore.getState().setSelectedNodeKey('.')
                    await (node as ResourceNode).close()
                    await (node.tree as ResourceTree).refresh()
                }
                break
        }
    }
}