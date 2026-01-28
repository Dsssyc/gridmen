import { LucideIcon, MapPin, SplinePointer, Square, SquaresUnite } from "lucide-react"

interface ResourceEntry {
    value: string
    label: string
    icon: LucideIcon
}

export const RESOURCE_REGISTRY: ResourceEntry[] = [
    {
        value: "schema",
        label: "Schema",
        icon: MapPin,
    },
    {
        value: "patch",
        label: "Patch",
        icon: Square,
    },
    {
        value: "vector",
        label: "Vector",
        icon: SplinePointer,
    },
    {
        value: "grid",
        label: "Grid",
        icon: SquaresUnite,
    },
]