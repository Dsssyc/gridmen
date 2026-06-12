import * as api from '../api/apis'
import { IResourceNode, IResourceTree } from "./iscene"
import { TEMPLATE_REGISTRY } from '@/registry/templateRegistry'
import { ITemplate } from '../iTemplate'
import { unlinkNode } from '../api/node'

export class ResourceNode implements IResourceNode {
    key: string
    lockId: string | null = null
    aligned: boolean = false
    isTemp: boolean = false
    tree: ResourceTree
    template: ITemplate | null
    parent: IResourceNode | null
    children: Map<string, IResourceNode> = new Map()

    context: any
    mountParams: any | null = null

    get id(): string { return this.key }
    get name(): string { return this.key.split('.').pop() || '' }
    get template_name(): string { return this.template?.templateName || '' }


    // private _pageContext: DefaultPageContext | undefined | null = null

    constructor(tree: ResourceTree, node_key: string, parent: IResourceNode | null, template: ITemplate | null) {
        this.key = node_key
        this.tree = tree
        this.parent = parent
        this.template = template
        this.context = undefined
        this.mountParams = undefined
    }

    async close(): Promise<void> {
        const cleanup = (this.context as any)?.__cleanup as Record<string, (() => void)>
        for (const dispose of Object.values(cleanup)) {
            dispose?.()
        }
        delete (this.context as any).__cleanup

        if (!this.isTemp) {
            await unlinkNode(this.nodeInfo, this.lockId!)
            this.lockId = null
        }
    }

    get nodeInfo(): string {
        return this.tree.leadIP ? `${this.tree.leadIP}::${this.key}` : this.key
    }
}

interface TreeUpdateCallback {
    (): void
}

interface ResourceTreeHandlers {
    onNodeMenuOpen: (node: IResourceNode, menuItem: any) => void
    onNodeRemove: (node: IResourceNode) => void
    onNodeClick: (node: IResourceNode) => void
    onNodeDoubleClick: (node: IResourceNode) => void
}

export class ResourceTree implements IResourceTree {
    root!: IResourceNode
    scene: Map<string, IResourceNode> = new Map()

    leadIP?: string

    private handleNodeClick: (node: IResourceNode) => void = () => { }
    private handleNodeDoubleClick: (node: IResourceNode) => void = () => { }
    private handleNodeMenuOpen: (node: IResourceNode, menuItem: any) => void = () => { }
    private handleNodeRemove: (node: IResourceNode) => void = () => { }

    private updateCallbacks: Set<TreeUpdateCallback> = new Set()
    private expandedNodes: Set<string> = new Set()

    editingNodeIds: Set<string> = new Set()
    selectedNode: IResourceNode | null = null
    tempNodeExist: boolean = false


    constructor(leadIP?: string) {
        this.leadIP = leadIP
    }

    bindHandlers(handlers: ResourceTreeHandlers): void {
        this.handleNodeMenuOpen = handlers.onNodeMenuOpen
        this.handleNodeRemove = handlers.onNodeRemove
        this.handleNodeClick = handlers.onNodeClick
        this.handleNodeDoubleClick = handlers.onNodeDoubleClick
    }

    getNodeMenuHandler(): (node: IResourceNode, menuItem: any) => void {
        return this.handleNodeMenuOpen
    }

    async setRoot(root: IResourceNode): Promise<void> {
        if (this.root) {
            console.debug('ResourceTree: setRoot: root already set')
            return
        }

        this.root = root
        this.scene.set(root.id, root)
        await this.alignNodeInfo(root)
        this.expandedNodes.add(root.id)
    }

    async alignNodeInfo(node: IResourceNode, force: boolean = false): Promise<void> {
        if (node.aligned && !force) return

        const meta = await api.node.getNodeBasicInfo({ nodeInfo: node.nodeInfo })

        const oldChildrenMap = node.children
        node.children = new Map()

        const backendChildKeys = new Set<string>()


        ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
        // Update parent-child relationship
        if (meta.children && meta.children.length > 0) {
            for (const child of meta.children) {
                backendChildKeys.add(child.node_key)
                if (oldChildrenMap.has(child.node_key)) {
                    const existingChild = oldChildrenMap.get(child.node_key)!
                    existingChild.parent = node
                    node.children.set(child.node_key, existingChild)
                    continue // skip if child node already exists
                }

                const childNode = new ResourceNode(this, child.node_key, node, TEMPLATE_REGISTRY[child.template_name])
                node.children.set(childNode.id, childNode) // Add child to the node's children map
                this.scene.set(childNode.id, childNode) // add child node to the scene map
            }
        }

        // Preserve in-memory temporary children that are not present in backend data
        for (const [childKey, childNode] of oldChildrenMap) {
            const resourceChild = childNode as ResourceNode
            if (resourceChild.isTemp && !node.children.has(childKey)) {
                resourceChild.parent = node
                node.children.set(childKey, resourceChild)
                this.scene.set(childKey, resourceChild)
            } else if (!resourceChild.isTemp && !backendChildKeys.has(childKey)) {
                // Drop stale non-temp nodes that no longer exist in backend
                this.scene.delete(childKey)
            }
        }
        ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

        // Release the old children map
        oldChildrenMap.clear()

        // Mark as aligned after loading
        node.aligned = true
    }

    async expandNode(targetNode: IResourceNode): Promise<boolean> {
        if (!targetNode) return false

        // Get all parent nodes
        const path: IResourceNode[] = []
        let current: IResourceNode | null = targetNode
        while (current) {
            path.unshift(current)
            current = current.parent
        }

        // Expand all parent nodes
        for (let i = 0; i < path.length - 1; i++) {
            const node = path[i]
            if (!this.expandedNodes.has(node.id)) {
                await this.alignNodeInfo(node)
                this.expandedNodes.add(node.id)
            }
        }

        // Select the target node
        this.notifyDomUpdate()
        return true
    }

    subscribe(callback: TreeUpdateCallback): () => void {
        this.updateCallbacks.add(callback)
        return () => {
            this.updateCallbacks.delete(callback)
        }
    }

    notifyDomUpdate(): void {
        this.updateCallbacks.forEach(callback => callback())
    }

    async toggleNodeExpansion(node: IResourceNode, forceOpen: boolean = false): Promise<void> {
        if (forceOpen || !this.expandedNodes.has(node.id)) {
            this.expandedNodes.add(node.id)
            if (!node.aligned) await this.alignNodeInfo(node)
        } else {
            this.expandedNodes.delete(node.id)
        }
    }

    async clickNode(node: IResourceNode): Promise<void> {
        this.selectedNode = node

        // If the node is a resource folder, toggle its expansion
        if (node.template_name === 'default') {
            await this.toggleNodeExpansion(node)
        }

        this.handleNodeClick(node) // notify all trees that the node is currently selected
        this.notifyDomUpdate()
    }

    /**
     * Create a temporary node purely in memory (no backend call).
     * NOTE: Any later refresh/align from backend may overwrite the in-memory structure.
     */
    addLocalNode(params: { node_key: string, template_name: string, parent_key?: string }): IResourceNode {
        const parentKey = params.parent_key ?? this.root?.key ?? '.'
        const parentNode = this.scene.get(parentKey) ?? this.root
        if (!parentNode) {
            throw new Error('ResourceTree.addLocalNode: root not initialized')
        }

        if (this.scene.has(params.node_key)) {
            return this.scene.get(params.node_key)!
        }

        const template = TEMPLATE_REGISTRY[params.template_name]
        const newNode = new ResourceNode(this, params.node_key, parentNode, template ?? null)
        newNode.aligned = true
        newNode.isTemp = true

        parentNode.children.set(newNode.id, newNode)
        this.scene.set(newNode.id, newNode)

        this.notifyDomUpdate()
        return newNode
    }

    async doubleClickNode(node: IResourceNode): Promise<void> {
        // If the node is a resource folder, force open its expansion
        if (node.template_name === 'default') {
            await this.toggleNodeExpansion(node, true)
        }

        this.handleNodeDoubleClick(node) // notify all trees to focus on the node
        this.notifyDomUpdate()
    }

    stopEditingNode(node: IResourceNode): void {

    }

    async removeNode(node: IResourceNode): Promise<void> {
        const parent = node.parent as ResourceNode
        parent.children.delete(node.id)

        this.scene.delete(node.id)
        await this.alignNodeInfo(parent, true)

        if (this.editingNodeIds.has(node.id))
            await this.stopEditingNode(node)

        this.handleNodeRemove(node) // notify all trees that the node has been removed
        this.notifyDomUpdate()
    }

    isNodeExpanded(nodeId: string): boolean {
        return this.expandedNodes.has(nodeId)
    }

    async refresh(): Promise<void> {
        if (!this.root) return

        // Refresh root node and all expanded nodes
        await this.alignNodeInfo(this.root, true)

        // Refresh all expanded nodes
        for (const nodeId of this.expandedNodes) {
            const node = this.scene.get(nodeId)
            if (node) {
                await this.alignNodeInfo(node, true)
            }
        }

        this.notifyDomUpdate()
    }

    static async create(leadIP?: string): Promise<ResourceTree> {
        try {
            const tree = new ResourceTree(leadIP)
            const nodeKey = leadIP ? `${leadIP}::.` : '.'

            const rootNodeMeta = await api.node.getNodeBasicInfo({ nodeInfo: nodeKey })
            const rootNode = new ResourceNode(tree, rootNodeMeta.node_key, null, TEMPLATE_REGISTRY[rootNodeMeta.template_name])

            await tree.setRoot(rootNode)

            return tree
        } catch (error) {
            throw new Error(`Failed to create resource tree: ${error}`)
        }
    }
}
