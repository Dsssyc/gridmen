import type { Map as MapboxMap } from 'mapbox-gl'

import type { RenderFrameSample } from './renderBenchmarkStats'
import { summarizeFrameSamples } from './renderBenchmarkStats'

type BenchmarkWorkload = 'static' | 'navigation'
type BenchmarkExportMode = 'console' | 'download' | 'both'
type BenchmarkState = 'armed' | 'warming' | 'measuring'

interface PatchRenderBenchmarkConfig {
    enabled: boolean
    benchmarkWorkload: BenchmarkWorkload
    benchmarkDurationMs: number
    benchmarkWarmupMs: number
    benchmarkLabel: string
    benchmarkExport: BenchmarkExportMode
}

interface PatchRenderBenchmarkOptions {
    map: MapboxMap
    topologyLayer: {
        addRenderSampleListener: (listener: (sample: RenderFrameSample) => void) => () => void
    }
    patchId: string
    cellCount: number | (() => number)
}

export interface PatchRenderBenchmarkResult {
    benchmark: 'patch-render'
    workload: BenchmarkWorkload
    label: string
    patchId: string
    cellCount: number
    readinessWaitMs: number
    startedAt: string
    durationMs: number
    warmupMs: number
    viewport: {
        width: number
        height: number
        devicePixelRatio: number
    }
    environment: {
        userAgent: string
    }
    summary: ReturnType<typeof summarizeFrameSamples>
    samples: RenderFrameSample[]
}

export interface PatchRenderBenchmarkHandle {
    stop: () => void
    result: Promise<PatchRenderBenchmarkResult | null>
}

const DEFAULT_DURATION_MS = 10000
const DEFAULT_WARMUP_MS = 3000

export function parsePatchRenderBenchmarkConfig(search = window.location.search): PatchRenderBenchmarkConfig {
    const params = new URLSearchParams(search)
    const benchmark = params.get('benchmark')
    const workload = params.get('benchmarkWorkload')
    const exportMode = params.get('benchmarkExport')

    return {
        enabled: benchmark === 'patch-render',
        benchmarkWorkload: workload === 'navigation' ? 'navigation' : 'static',
        benchmarkDurationMs: parsePositiveNumber(params.get('benchmarkDurationMs'), DEFAULT_DURATION_MS),
        benchmarkWarmupMs: parsePositiveNumber(params.get('benchmarkWarmupMs'), DEFAULT_WARMUP_MS),
        benchmarkLabel: params.get('benchmarkLabel') ?? '',
        benchmarkExport: parseExportMode(exportMode),
    }
}

export function startPatchRenderBenchmark(options: PatchRenderBenchmarkOptions): PatchRenderBenchmarkHandle | null {
    const config = parsePatchRenderBenchmarkConfig()
    if (!config.enabled) {
        console.debug('[patch-render-benchmark] disabled', {
            search: window.location.search,
        })
        return null
    }

    return runPatchRenderBenchmark(config, options)
}

function runPatchRenderBenchmark(
    config: PatchRenderBenchmarkConfig,
    options: PatchRenderBenchmarkOptions,
): PatchRenderBenchmarkHandle {
    const armedAt = new Date()
    const armedAtMs = performance.now()
    const canvas = options.map.getCanvas()
    const measuredSamples = new Array<RenderFrameSample>()

    let startedAt = armedAt
    let state: BenchmarkState = 'armed'
    let stopped = false
    let animationFrameId = 0
    let firstSampleAtMs: number | null = null
    let measureStartMs = Number.POSITIVE_INFINITY
    let stopAtMs = Number.POSITIVE_INFINITY
    let stopNavigation = () => { }
    let resolveResult: (result: PatchRenderBenchmarkResult | null) => void

    const result = new Promise<PatchRenderBenchmarkResult | null>(resolve => {
        resolveResult = resolve
    })

    const unsubscribe = options.topologyLayer.addRenderSampleListener(sample => {
        if (stopped) return
        if (state === 'armed') {
            startMeasurementClock(sample)
        }
        if (sample.timestampMs < measureStartMs) return
        state = 'measuring'
        measuredSamples.push(sample)
    })

    const repaint = () => {
        if (stopped) return

        const now = performance.now()
        if (Number.isFinite(stopAtMs) && now >= stopAtMs) {
            finish()
            return
        }

        options.map.triggerRepaint()
        animationFrameId = window.requestAnimationFrame(repaint)
    }

    animationFrameId = window.requestAnimationFrame(repaint)

    const startMeasurementClock = (firstSample: RenderFrameSample) => {
        firstSampleAtMs = firstSample.timestampMs
        measureStartMs = firstSampleAtMs + config.benchmarkWarmupMs
        stopAtMs = measureStartMs + config.benchmarkDurationMs
        startedAt = new Date(armedAt.getTime() + (firstSampleAtMs - armedAtMs))
        state = config.benchmarkWarmupMs > 0 ? 'warming' : 'measuring'

        if (config.benchmarkWorkload === 'navigation') {
            stopNavigation = startNavigationWorkload(options.map, stopAtMs, () => stopped)
        }

        console.info('[patch-render-benchmark] first render sample', {
            readinessWaitMs: firstSampleAtMs - armedAtMs,
            workload: config.benchmarkWorkload,
            durationMs: config.benchmarkDurationMs,
            warmupMs: config.benchmarkWarmupMs,
            patchId: options.patchId,
            cellCount: firstSample.cellCount,
            measureStartMs,
            stopAtMs,
        })
    }

    const stop = () => {
        if (stopped) return
        stopped = true
        unsubscribe()
        stopNavigation()
        window.cancelAnimationFrame(animationFrameId)
        resolveResult(null)
    }

    const finish = () => {
        if (stopped) return
        stopped = true
        unsubscribe()
        stopNavigation()
        window.cancelAnimationFrame(animationFrameId)

        const resultPayload: PatchRenderBenchmarkResult = {
            benchmark: 'patch-render',
            workload: config.benchmarkWorkload,
            label: config.benchmarkLabel,
            patchId: options.patchId,
            cellCount: getBenchmarkCellCount(options, measuredSamples),
            readinessWaitMs: firstSampleAtMs === null ? 0 : firstSampleAtMs - armedAtMs,
            startedAt: startedAt.toISOString(),
            durationMs: config.benchmarkDurationMs,
            warmupMs: config.benchmarkWarmupMs,
            viewport: {
                width: canvas.width,
                height: canvas.height,
                devicePixelRatio: window.devicePixelRatio,
            },
            environment: {
                userAgent: window.navigator.userAgent,
            },
            summary: summarizeFrameSamples(measuredSamples),
            samples: measuredSamples,
        }

        exportResult(resultPayload, config.benchmarkExport)
        resolveResult(resultPayload)
    }

    console.info('[patch-render-benchmark] armed', {
        search: window.location.search,
        workload: config.benchmarkWorkload,
        durationMs: config.benchmarkDurationMs,
        warmupMs: config.benchmarkWarmupMs,
        patchId: options.patchId,
        cellCount: getBenchmarkCellCount(options, measuredSamples),
        state,
    })

    return { stop, result }
}

function startNavigationWorkload(map: MapboxMap, stopAtMs: number, isStopped: () => boolean): () => void {
    const start = performance.now()
    const center = map.getCenter()
    const zoom = map.getZoom()
    let frameId = 0

    const animate = () => {
        if (isStopped()) return
        const now = performance.now()
        if (now >= stopAtMs) return

        const elapsed = now - start
        const phase = elapsed / 1000
        const lngOffset = Math.sin(phase * Math.PI * 0.35) * 0.0008
        const latOffset = Math.cos(phase * Math.PI * 0.35) * 0.0008
        const zoomOffset = Math.sin(phase * Math.PI * 0.2) * 0.12

        map.jumpTo({
            center: [center.lng + lngOffset, center.lat + latOffset],
            zoom: zoom + zoomOffset,
        })

        frameId = window.requestAnimationFrame(animate)
    }

    frameId = window.requestAnimationFrame(animate)

    return () => {
        window.cancelAnimationFrame(frameId)
        map.jumpTo({ center, zoom })
    }
}

function parsePositiveNumber(rawValue: string | null, fallback: number): number {
    if (!rawValue) return fallback

    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback

    return parsed
}

function parseExportMode(rawValue: string | null): BenchmarkExportMode {
    if (rawValue === 'console' || rawValue === 'download' || rawValue === 'both') {
        return rawValue
    }
    return 'both'
}

function getBenchmarkCellCount(options: PatchRenderBenchmarkOptions, samples: RenderFrameSample[]): number {
    const sampledCellCount = samples.length > 0 ? samples[samples.length - 1].cellCount : undefined
    if (sampledCellCount !== undefined) return sampledCellCount

    return typeof options.cellCount === 'function' ? options.cellCount() : options.cellCount
}

function exportResult(result: PatchRenderBenchmarkResult, mode: BenchmarkExportMode): void {
    if (mode === 'console' || mode === 'both') {
        console.info('[patch-render-benchmark] result', result)
    }

    if (mode === 'download' || mode === 'both') {
        downloadJson(result)
    }
}

function downloadJson(result: PatchRenderBenchmarkResult): void {
    const safeLabel = result.label ? `-${sanitizeFilePart(result.label)}` : ''
    const fileName = `patch-render-${result.workload}-${result.cellCount}-cells${safeLabel}.json`
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = fileName
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
}

function sanitizeFilePart(value: string): string {
    return value
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
}
