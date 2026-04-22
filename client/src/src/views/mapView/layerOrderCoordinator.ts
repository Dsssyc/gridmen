import mapboxgl from 'mapbox-gl'
import { useLayerStore } from '@/store/storeSet'
import type { Layer } from '@/store/storeTypes'

class LayerOrderCoordinator {
    private map: mapboxgl.Map | null = null
    private ownership = new Map<string, string[]>() // panelLayerId -> mapbox layer ids
    private unsubscribe: (() => void) | null = null
    private pendingApply = false

    setMap(map: mapboxgl.Map) {
        this.map = map
        if (this.unsubscribe) this.unsubscribe()
        this.unsubscribe = useLayerStore.subscribe(() => this.apply())
        this.apply()
    }

    register(panelLayerId: string, mapboxLayerIds: string[]) {
        this.ownership.set(panelLayerId, mapboxLayerIds)
        this.apply()
    }

    unregister(panelLayerId: string) {
        this.ownership.delete(panelLayerId)
        this.apply()
    }

    apply() {
        const map = this.map
        if (!map) return
        if (!map.isStyleLoaded()) {
            if (this.pendingApply) return
            this.pendingApply = true
            map.once('idle', () => {
                this.pendingApply = false
                this.apply()
            })
            return
        }

        const order = this.flattenPanel(useLayerStore.getState().layers)
        // panel: top-first. Walk panel from BOTTOM to TOP. For each owner, call
        // map.moveLayer(id) (no beforeId) which moves the layer to the very top
        // of the mapbox layer stack. After the loop, panel-top will be at the
        // top of the mapbox stack — exactly the desired result.
        for (let i = order.length - 1; i >= 0; i--) {
            const ids = this.ownership.get(order[i])
            if (!ids) continue
            for (const id of ids) {
                if (map.getLayer(id)) {
                    try {
                        map.moveLayer(id)
                    } catch (e) {
                        console.warn('[layerOrderCoordinator] moveLayer failed', id, e)
                    }
                }
            }
        }
    }

    private flattenPanel(layers: Layer[]): string[] {
        const out: string[] = []
        const walk = (arr: Layer[]) => {
            for (const l of arr) {
                if (l.type === 'group') {
                    if (l.children) walk(l.children)
                } else {
                    out.push(l.id)
                }
            }
        }
        walk(layers)
        return out
    }
}

export const layerOrderCoordinator = new LayerOrderCoordinator()
