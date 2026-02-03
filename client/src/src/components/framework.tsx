import { useCallback, useEffect, useMemo, useReducer, useState } from "react"
import LoginPage from "./loginPage/loginPage"
import ResourceTreeComponent from "./resourceTree"
import SettingView from "./settingView/settingView"
import { ICON_REGISTRY } from "@/registry/iconRegistry"
import { IResourceNode } from "@/template/scene/iscene"
import IconBar, { IconBarClickHandlers } from "./iconBar"
import MapViewComponent from "@/views/mapView/mapViewComponent"
import { ResourceNode, ResourceTree } from "@/template/scene/scene"
import TableViewComponent from "@/views/tableView/tableViewComponent"
import { useSelectedNodeStore, useSettingStore, useToolPanelStore } from "@/store/storeSet"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom"
import Hello from "./helloPage/hello"

export default function Framework() {

    return (
        <Router>
            <FrameworkShell />
        </Router>
    )
}

function FrameworkShell() {

    const location = useLocation()
    const navigate = useNavigate()

    const [triggerFocus, setTriggerFocus] = useState(0)
    const [activeIconID, setActiveIconID] = useState<'map-view' | 'table-view' | 'settings'>('map-view')
    const [isLoggedIn, setIsLoggedIn] = useState(true)

    const [privateTree, setPrivateTree] = useState<ResourceTree | null>(null)
    const [publicTree, setPublicTree] = useState<ResourceTree | null>(null)
    const [focusNode, setFocusNode] = useState<IResourceNode | null>(null)

    const publicIP = useSettingStore(state => state.publicIP)
    const { selectedNodeKey, setSelectedNodeKey } = useSelectedNodeStore()

    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    const handleIconClick = useCallback((iconID: string) => {
        switch (iconID) {
            case 'map-view':
                setActiveIconID('map-view')
                if (!isLoggedIn) {
                    navigate('/login')
                    return
                }
                navigate('/framework')
                return
            case 'table-view':
                setActiveIconID('table-view')
                if (!isLoggedIn) {
                    navigate('/login')
                    return
                }
                navigate('/framework')
                return
            case 'settings':
                setActiveIconID('settings')
                if (!isLoggedIn) {
                    navigate('/login')
                    return
                }
                navigate('/framework')
                return
            case 'user':
                navigate('/login')
                return
            default:
                // keep existing behavior for other icons (e.g. languages)
                return
        }
    }, [isLoggedIn, navigate])

    const iconClickHandlers: IconBarClickHandlers = useMemo(() => {
        const handlers: IconBarClickHandlers = {}
        ICON_REGISTRY.forEach(icon => {
            handlers[icon.id] = handleIconClick
        })
        return handlers
    }, [handleIconClick])

    const currentActiveId = useMemo(() => {
        const path = location.pathname
        if (path.startsWith('/framework')) return activeIconID
        if (path.startsWith('/login')) return 'user'
        // /hello (and others): no active icon
        return null
    }, [activeIconID, location.pathname])

    // Login route wrapper to perform navigation after login
    function LoginRoute({ onLogin }: { onLogin: () => void }) {
        const handleLogin = () => {
            onLogin()
            navigate('/framework')
        }
        return <LoginPage onLogin={handleLogin} />
    }

    const handleNodeMenuOpen = useCallback((node: IResourceNode, menuItem: any) => {

        if (privateTree === null && publicTree === null) return

        const treeOfNode = node.tree as ResourceTree

        // Decide which ToolPanel tab to switch to (if any)
        let nextTab: 'create' | 'check' | 'edit' | null = null
        if (typeof menuItem === 'string') {
            const key = menuItem.toLowerCase()
            if (key.includes('edit')) nextTab = 'edit'
            else if (key.includes('check')) nextTab = 'check'
            else if (key.includes('create')) nextTab = 'create'
        }

        const applySelection = () => {
            if (privateTree) privateTree.selectedNode = null
            if (publicTree) publicTree.selectedNode = null
            treeOfNode.selectedNode = node
            treeOfNode.notifyDomUpdate()
            setSelectedNodeKey(node.key)
        }

        const isDestructiveAction = (() => {
            if (typeof menuItem !== 'string') return false
            const key = menuItem.toLowerCase()
            return key.includes('delete') || key.includes('remove') || key.includes('unmount') || key.includes('unlink')
        })()

        // IMPORTANT: If template action is async (e.g. linkNode -> sets lockId),
        // wait for it before applying selection + switching tabs, so we don't briefly render
        // this node under the previous tab (often 'create') and then jump again.
        const maybePromise = node.template?.handleMenuOpen(node, menuItem)
        const isThenable = !!maybePromise && typeof (maybePromise as any).then === 'function'

        // Destructive actions shouldn't change selection/tab; selecting the node would
        // briefly render its current tab (often 'create') which looks like a navigation jump.
        if (isDestructiveAction) {
            if (isThenable) {
                ; (maybePromise as Promise<void>).catch((err) => {
                    console.error('handleMenuOpen failed:', err)
                })
            }
            return
        }

        if (isThenable) {
            ; (maybePromise as Promise<void>)
                .then(() => {
                    applySelection()
                    if (nextTab) useToolPanelStore.getState().setActiveTab(nextTab)
                })
                .catch((err) => {
                    console.error('handleMenuOpen failed:', err)
                })
            return
        }

        // Sync path: apply selection immediately.
        applySelection()
        if (nextTab) useToolPanelStore.getState().setActiveTab(nextTab)
    }, [privateTree, publicTree])

    const handleNodeRemove = useCallback((node: IResourceNode) => {

        if (privateTree === null || publicTree === null) return

        const _node = node as ResourceNode
        const tree = _node.tree as ResourceTree

        publicTree.selectedNode = null
        privateTree.selectedNode = null

        if (focusNode && focusNode.id === _node.id) {
            if (_node.parent) {
                tree.selectedNode = _node.parent
                tree.editingNodeIds.has(_node.parent.id) && setFocusNode(_node.parent)
            }
            else setFocusNode(null)
            setTriggerFocus(prev => prev + 1)
        }
        else if (focusNode && focusNode.id !== _node.id) {
            console.debug(`currently focused node ${focusNode.id} is not the removed node ${_node.id}, reselecting it`);
            (focusNode.tree as ResourceTree).selectedNode = focusNode
            setFocusNode(focusNode)
            setTriggerFocus(prev => prev + 1)
        }
    }, [focusNode, publicTree, privateTree])

    const handleNodeClick = useCallback((node: IResourceNode) => {
        if (privateTree === null || publicTree === null) return
        const _node = node as ResourceNode

        privateTree.selectedNode = null
        publicTree.selectedNode = null
        _node.tree.selectedNode = _node
        setSelectedNodeKey(_node.key)
    }, [privateTree, publicTree, setSelectedNodeKey])

    const handleNodeDoubleClick = useCallback((node: IResourceNode) => {
        const _node = node as ResourceNode

        if (privateTree === null || publicTree === null) return
        privateTree.selectedNode = null
        publicTree.selectedNode = null

        _node.tree.selectedNode = _node
        setSelectedNodeKey(_node.key)

    }, [privateTree, publicTree, setSelectedNodeKey])

    useEffect(() => {
        // Only initialize resource trees when actually entering /framework and logged in.
        if (!isLoggedIn) return
        if (!location.pathname.startsWith('/framework')) return
        if (privateTree || publicTree) return

        const initTree = async () => {
            try {
                /// PRIVATE ///
                const _privateTree = await ResourceTree.create()
                _privateTree.subscribe(triggerRepaint)
                setPrivateTree(_privateTree)

                /// PUBLIC ///
                const _publicTree = await ResourceTree.create(publicIP!)
                _publicTree.subscribe(triggerRepaint)
                setPublicTree(_publicTree)

            } catch (error) {
                console.error('Failed to initialize tree:', error)
            }
        }
        initTree()
    }, [isLoggedIn, location.pathname, privateTree, publicTree, publicIP])

    useEffect(() => {
        if (!privateTree || !publicTree || !selectedNodeKey) return
        if (privateTree.selectedNode || publicTree.selectedNode) return

        const nodeInPrivate = privateTree.scene.get(selectedNodeKey)
        if (nodeInPrivate) {
            privateTree.selectedNode = nodeInPrivate
            privateTree.notifyDomUpdate()
            return
        }

        const nodeInPublic = publicTree.scene.get(selectedNodeKey)
        if (nodeInPublic) {
            publicTree.selectedNode = nodeInPublic
            publicTree.notifyDomUpdate()
        }
    }, [privateTree, publicTree, selectedNodeKey])

    const getCurrentTemplateName = (): string => {
        const selectedNode = privateTree?.selectedNode || publicTree?.selectedNode
        return selectedNode?.template_name || 'default'
    }

    const getResourceNodeByKey = useCallback((key: string): IResourceNode | null => {
        const inPrivate = privateTree?.scene.get(key) ?? null
        if (inPrivate) return inPrivate
        const inPublic = publicTree?.scene.get(key) ?? null
        return inPublic
    }, [privateTree, publicTree])

    const renderActiveView = () => {
        const currentTemplateName = getCurrentTemplateName()
        const selectedNode = privateTree?.selectedNode || publicTree?.selectedNode
        switch (activeIconID) {
            case 'map-view':
                return <MapViewComponent templateName={currentTemplateName} selectedNode={selectedNode} getResourceNodeByKey={getResourceNodeByKey} />
            case 'table-view':
                return <TableViewComponent />
            case 'settings':
                return <SettingView />
            default:
                return <MapViewComponent templateName={currentTemplateName} selectedNode={selectedNode} getResourceNodeByKey={getResourceNodeByKey} />
        }
    }

    return (
        <div className='w-screen h-screen bg-[#1E1E1E] flex'>
            <IconBar
                currentActiveId={currentActiveId}
                clickHandlers={iconClickHandlers}
                isLoggedIn={isLoggedIn}
            />
            <Routes>
                <Route path='/' element={<Navigate to="/hello" replace />} />
                <Route path='hello' element={<Hello />} />
                <Route
                    path='login'
                    element={
                        isLoggedIn
                            ? <Navigate to="/framework" replace />
                            : <LoginRoute onLogin={() => setIsLoggedIn(true)} />
                    }
                />
                <Route
                    path="framework"
                    element={
                        isLoggedIn
                            ? (
                                activeIconID === 'settings'
                                    ? (
                                        <div className="h-full w-[98%]">
                                            {renderActiveView()}
                                        </div>
                                    )
                                    : (
                                        <ResizablePanelGroup
                                            direction="horizontal"
                                            className="h-full w-[98%] text-white"
                                        >
                                            <ResizablePanel defaultSize={10.5}>
                                                <ResourceTreeComponent
                                                    privateTree={privateTree}
                                                    publicTree={publicTree}
                                                    focusNode={focusNode}
                                                    triggerFocus={triggerFocus}
                                                    onNodeMenuOpen={handleNodeMenuOpen}
                                                    onNodeRemove={handleNodeRemove}
                                                    onNodeClick={handleNodeClick}
                                                    onNodeDoubleClick={handleNodeDoubleClick}
                                                />
                                            </ResizablePanel>
                                            <ResizableHandle className="opacity-0 hover:bg-blue-200" />
                                            <ResizablePanel defaultSize={89.5}>
                                                {renderActiveView()}
                                            </ResizablePanel>
                                        </ResizablePanelGroup>
                                    )
                            )
                            : <Navigate to="/login" replace />
                    }
                />
            </Routes>
        </div>
    )
}
