import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { Layer, LayerGroupStore, LayerStore, SelectedNodeStore, SettingsProps, TempNewNodeProps, ToolPanelStore } from "./storeTypes"
import { ResourceNode } from '@/template/scene/scene'

export const DEFAULT_LEAD_IP = 'http://127.0.0.1:8001'

export const DEFAULT_MAP_INITIAL_LONGITUDE = 114.051537
export const DEFAULT_MAP_INITIAL_LATITUDE = 22.446937

export const useSettingStore = create<SettingsProps>()(
    persist(
        (set) => ({
            publicIP: DEFAULT_LEAD_IP,
            highSpeedMode: false,
            mapInitialLongitude: DEFAULT_MAP_INITIAL_LONGITUDE,
            mapInitialLatitude: DEFAULT_MAP_INITIAL_LATITUDE,
            setLeadIP: (leadIP: string) => set({ publicIP: leadIP }),
            setHighSpeedMode: (highSpeedMode: boolean) => set({ highSpeedMode }),
            setMapInitialLongitude: (lng: number) => set({ mapInitialLongitude: lng }),
            setMapInitialLatitude: (lat: number) => set({ mapInitialLatitude: lat }),
            setMapInitialCenter: (lng: number, lat: number) => set({ mapInitialLongitude: lng, mapInitialLatitude: lat }),
        }),
        {
            name: 'gridmen:settings',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                publicIP: state.publicIP,
                highSpeedMode: state.highSpeedMode,
                mapInitialLongitude: state.mapInitialLongitude,
                mapInitialLatitude: state.mapInitialLatitude,
            }),
        },
    ),
)

export const useSelectedNodeStore = create<SelectedNodeStore>((set) => ({
    selectedNodeKey: null,
    setSelectedNodeKey: (key: string | null) => set({ selectedNodeKey: key }),
}))


const DEFAULT_LAYERS: Layer[] = [
    // {
    //     id: "base-map",
    //     name: "Base Map",
    //     visible: true,
    //     type: "group",
    //     children: [],
    // },
    {
        id: "resource-node",
        name: "Resource Node",
        visible: true,
        type: "group",
        children: [],
        node: null,
    },
]

export const useLayerStore = create<LayerStore>((set) => ({
    layers: DEFAULT_LAYERS,
    layerNodes: [],
    setLayers: (next) => {
        set((state) => ({
            layers: typeof next === 'function' ? next(state.layers) : next,
        }))
    },
    addLayerNode: (node: ResourceNode) => {
        set((state) => {
            const exists = state.layerNodes.some((n) => n.key === node.key)
            if (exists) return state
            return { layerNodes: [...state.layerNodes, node] }
        })
    },
    removeLayerNode: (nodeKey: string) => {
        set((state) => ({
            layerNodes: state.layerNodes.filter((n) => n.key !== nodeKey),
        }))
    },
    clearLayerNodes: () => {
        set({ layerNodes: [] })
    },
    addNodeToLayerGroup: (node: ResourceNode) => {
        const nextLayer: Layer = {
            id: node.key,
            name: node.key.split('.').slice(-1)[0],
            visible: true,
            type: "Layer",
            template: node.template_name,
            node: node,
        }

        const resourceGroup: Layer = {
            id: "resource-node",
            name: "Resource Node",
            visible: true,
            type: "group",
            children: [],
            node: null,
        }

        set((state) => {
            const update = (layers: Layer[]): Layer[] => {
                const hasGroup = layers.some((l) => l.name === "Resource Node" && l.type === "group")
                const ensured = hasGroup
                    ? layers
                    : [
                        ...layers,
                        resourceGroup,
                    ]

                return ensured.map((layer) => {
                    if (layer.name !== "Resource Node" || layer.type !== "group") {
                        return layer
                    }

                    const children = layer.children ?? []
                    const exists = children.some((c) => c.id === node.key)
                    if (exists) {
                        return layer
                    }

                    return {
                        ...layer,
                        children: [nextLayer, ...children],
                    }
                })
            }

            return { layers: update(state.layers) }
        })

        // 同步维护 ResourceNode 列表（与 layers 解耦）
        set((state) => {
            const exists = state.layerNodes.some((n) => n.key === node.key)
            if (exists) return state
            return { layerNodes: [...state.layerNodes, node] }
        })
    },
}))

export const useToolPanelStore = create<ToolPanelStore>((set) => ({
    activeTab: 'create',
    setActiveTab: (tab) => set({ activeTab: tab }),
}))

export const useLayerGroupStore = create<LayerGroupStore>((set) => ({
    isEditMode: false,
    setEditMode: (isEdit) => set({ isEditMode: isEdit }),
}))