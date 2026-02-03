import { ICON_REGISTRY } from '@/registry/iconRegistry'
import { cn } from '@/utils/utils'
import { LucideProps } from 'lucide-react'
import { useReducer, useRef, useState } from 'react'

export interface IconBarClickHandlers {
    [iconID: string]: (iconID: string) => void
}

interface IconBarProps {
    currentActiveId?: string | null
    clickHandlers: IconBarClickHandlers
    isLoggedIn: boolean
}

export interface IconEntry {
    id: string
    label: string
    style?: string
    icon: React.ComponentType<LucideProps>
}

export default function IconBar({ currentActiveId, clickHandlers, isLoggedIn = false }: IconBarProps) {
    const [, triggerRepaint] = useReducer(x => x + 1, 0)

    return (
        <div className='w-[2%] h-full bg-[#333333] flex flex-col items-center py-2'>
            {ICON_REGISTRY.map(item => (
                <button
                    type='button'
                    id={item.id}
                    key={item.id}
                    title={item.label}
                    onClick={() => {
                        if (!isLoggedIn && (item.id === 'map-view' || item.id === 'table-view')) return
                        clickHandlers[item.id] && clickHandlers[item.id](item.id)
                        triggerRepaint()
                    }}
                    disabled={!isLoggedIn && (item.id === 'map-view' || item.id === 'table-view')}
                    className={
                        cn(
                            'w-10 h-10 mb-1 cursor-pointer flex items-center justify-center', // default styles
                            item.style && item.style,
                            currentActiveId === item.id && 'border-r-2 border-gray-200',
                            !isLoggedIn && (item.id === 'map-view' || item.id === 'table-view') && 'opacity-50 cursor-not-allowed',
                        )
                    }
                >
                    <item.icon className={cn(
                        'w-5 h-5',
                        currentActiveId === item.id ? 'text-gray-200' : 'text-gray-400 hover:text-gray-200',
                    )} />
                </button>
            ))}
        </div>
    )
}
