import { IconEntry } from "@/components/iconBar"
import { Settings, Languages, User, Map, ChartArea } from 'lucide-react'

export const ICON_REGISTRY: IconEntry[] = [
    { id: 'map-view', icon: Map, label: 'Map View' },
    // { id: 'table-view', icon: ChartArea, label: 'Table View' },
    { id: 'settings', icon: Settings, label: 'Settings' },
    // { id: 'languages', icon: Languages, label: 'Languages', style: 'mt-auto' },
    // { id: 'user', icon: User, label: 'User', style: '!border-blue-500' }
]