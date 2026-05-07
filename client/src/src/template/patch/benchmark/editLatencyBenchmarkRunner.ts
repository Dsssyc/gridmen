import type { Map as MapboxMap } from 'mapbox-gl'

import {
    EditLatencyOperation,
    EditLatencySummary,
    EditLatencyTrial,
    summarizeEditLatencyTrials,
} from './editLatencyStats'
import type { TopologyRenderSample } from '@/views/mapView/topology/renderSample'

type BenchmarkOperationFilter = EditLatencyOperation | 'all'
type BenchmarkExportMode = 'console' | 'download' | 'both'

interface PatchEditLatencyBenchmarkConfig {
    enabled: boolean
    benchmarkTrials: number
    benchmarkWarmupFrames: number
    benchmarkOperation: BenchmarkOperationFilter
    benchmarkLabel: string
    benchmarkExport: BenchmarkExportMode
}

interface BenchmarkEditOperationResult {
    operation: EditLatencyOperation
    cellCountBefore: number
    cellCountAfter: number
    selectedCellCount: number
    target?: Record<string, unknown>
}

interface PatchEditLatencyBenchmarkOptions {
    map: Pick<MapboxMap, 'getCanvas'>
    topologyLayer: {
        waitForBenchmarkRenderFrame: (timeoutMs?: number) => Promise<TopologyRenderSample>
        runBenchmarkEditOperation: (
            operation: EditLatencyOperation,
            trialIndex: number,
        ) => Promise<BenchmarkEditOperationResult>
    }
    patchId: string
    cellCount: number | (() => number)
}

export interface PatchEditLatencyBenchmarkResult {
    benchmark: 'patch-edit-latency'
    label: string
    patchId: string
    startedAt: string
    initialCellCount: number
    finalCellCount: number
    readinessWaitMs: number
    config: {
        trials: number
        warmupFrames: number
        operation: BenchmarkOperationFilter
    }
    viewport: {
        width: number
        height: number
        devicePixelRatio: number
    }
    environment: {
        userAgent: string
    }
    trials: EditLatencyTrial[]
    summary: EditLatencySummary
}

export interface PatchEditLatencyBenchmarkHandle {
    stop: () => void
    result: Promise<PatchEditLatencyBenchmarkResult | null>
}

const DEFAULT_TRIALS = 30
const DEFAULT_WARMUP_FRAMES = 3
const OPERATIONS: EditLatencyOperation[] = ['pick', 'subdivide', 'merge', 'delete', 'recover']

export function parsePatchEditLatencyBenchmarkConfig(search = window.location.search): PatchEditLatencyBenchmarkConfig {
    const params = new URLSearchParams(search)
    const benchmark = params.get('benchmark')

    return {
        enabled: benchmark === 'patch-edit-latency',
        benchmarkTrials: parsePositiveInteger(params.get('benchmarkTrials'), DEFAULT_TRIALS),
        benchmarkWarmupFrames: parseNonNegativeInteger(params.get('benchmarkWarmupFrames'), DEFAULT_WARMUP_FRAMES),
        benchmarkOperation: parseOperationFilter(params.get('benchmarkOperation')),
        benchmarkLabel: params.get('benchmarkLabel') ?? '',
        benchmarkExport: parseExportMode(params.get('benchmarkExport')),
    }
}

export function startPatchEditLatencyBenchmark(
    options: PatchEditLatencyBenchmarkOptions,
    config = parsePatchEditLatencyBenchmarkConfig(),
): PatchEditLatencyBenchmarkHandle | null {
    if (!config.enabled) {
        console.debug('[patch-edit-latency-benchmark] disabled', {
            search: window.location.search,
        })
        return null
    }

    return runPatchEditLatencyBenchmark(config, options)
}

function runPatchEditLatencyBenchmark(
    config: PatchEditLatencyBenchmarkConfig,
    options: PatchEditLatencyBenchmarkOptions,
): PatchEditLatencyBenchmarkHandle {
    let stopped = false
    let resolveResult: (result: PatchEditLatencyBenchmarkResult | null) => void

    const result = new Promise<PatchEditLatencyBenchmarkResult | null>(resolve => {
        resolveResult = resolve
    })

    const stop = () => {
        if (stopped) return
        stopped = true
        resolveResult(null)
    }

    void executeBenchmark().then(payload => {
        if (stopped) return
        stopped = true
        exportResult(payload, config.benchmarkExport)
        resolveResult(payload)
    }).catch(error => {
        if (stopped) return
        stopped = true
        console.error('[patch-edit-latency-benchmark] failed', error)
        resolveResult(null)
    })

    async function executeBenchmark(): Promise<PatchEditLatencyBenchmarkResult> {
        const armedAt = new Date()
        const armedAtMs = performance.now()
        const firstSample = await options.topologyLayer.waitForBenchmarkRenderFrame(0)
        const readinessWaitMs = Math.max(0, firstSample.timestampMs - armedAtMs)
        const startedAt = new Date(armedAt.getTime() + readinessWaitMs)
        const initialCellCount = getBenchmarkCellCount(options)
        const trials: EditLatencyTrial[] = []

        for (let frame = 0; frame < config.benchmarkWarmupFrames; frame += 1) {
            if (stopped) break
            await options.topologyLayer.waitForBenchmarkRenderFrame()
        }

        for (let trialIndex = 0; trialIndex < config.benchmarkTrials; trialIndex += 1) {
            for (const operation of getOperations(config.benchmarkOperation)) {
                if (stopped) break
                trials.push(await runTrial(operation, trialIndex))
                if (!stopped) {
                    await options.topologyLayer.waitForBenchmarkRenderFrame()
                }
            }
        }

        const canvas = options.map.getCanvas()

        return {
            benchmark: 'patch-edit-latency',
            label: config.benchmarkLabel,
            patchId: options.patchId,
            startedAt: startedAt.toISOString(),
            initialCellCount,
            finalCellCount: getBenchmarkCellCount(options),
            readinessWaitMs,
            config: {
                trials: config.benchmarkTrials,
                warmupFrames: config.benchmarkWarmupFrames,
                operation: config.benchmarkOperation,
            },
            viewport: {
                width: canvas.width,
                height: canvas.height,
                devicePixelRatio: window.devicePixelRatio,
            },
            environment: {
                userAgent: window.navigator.userAgent,
            },
            trials,
            summary: summarizeEditLatencyTrials(trials),
        }
    }

    async function runTrial(operation: EditLatencyOperation, trialIndex: number): Promise<EditLatencyTrial> {
        const startedAt = performance.now()
        const cellCountBefore = getBenchmarkCellCount(options)

        try {
            const operationResult = await options.topologyLayer.runBenchmarkEditOperation(operation, trialIndex)
            return {
                operation,
                trialIndex,
                success: true,
                latencyMs: performance.now() - startedAt,
                cellCountBefore: operationResult.cellCountBefore,
                cellCountAfter: operationResult.cellCountAfter,
                selectedCellCount: operationResult.selectedCellCount,
                target: operationResult.target,
            }
        } catch (error) {
            return {
                operation,
                trialIndex,
                success: false,
                failureReason: error instanceof Error ? error.message : String(error),
                cellCountBefore,
                cellCountAfter: getBenchmarkCellCount(options),
                selectedCellCount: 0,
            }
        }
    }

    console.info('[patch-edit-latency-benchmark] armed', {
        patchId: options.patchId,
        cellCount: getBenchmarkCellCount(options),
        trials: config.benchmarkTrials,
        warmupFrames: config.benchmarkWarmupFrames,
        operation: config.benchmarkOperation,
    })

    return { stop, result }
}

function getOperations(filter: BenchmarkOperationFilter): EditLatencyOperation[] {
    if (filter === 'all') return OPERATIONS
    return [filter]
}

function parseOperationFilter(rawValue: string | null): BenchmarkOperationFilter {
    if (rawValue === 'pick' || rawValue === 'subdivide' || rawValue === 'merge' || rawValue === 'delete' || rawValue === 'recover') {
        return rawValue
    }
    return 'all'
}

function parsePositiveInteger(rawValue: string | null, fallback: number): number {
    if (!rawValue) return fallback

    const parsed = Number(rawValue)
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback

    return parsed
}

function parseNonNegativeInteger(rawValue: string | null, fallback: number): number {
    if (!rawValue) return fallback

    const parsed = Number(rawValue)
    if (!Number.isInteger(parsed) || parsed < 0) return fallback

    return parsed
}

function parseExportMode(rawValue: string | null): BenchmarkExportMode {
    if (rawValue === 'console' || rawValue === 'download' || rawValue === 'both') {
        return rawValue
    }
    return 'both'
}

function getBenchmarkCellCount(options: PatchEditLatencyBenchmarkOptions): number {
    return typeof options.cellCount === 'function' ? options.cellCount() : options.cellCount
}

function exportResult(result: PatchEditLatencyBenchmarkResult, mode: BenchmarkExportMode): void {
    if (mode === 'console' || mode === 'both') {
        console.info('[patch-edit-latency-benchmark] result', result)
    }

    if (mode === 'download' || mode === 'both') {
        downloadJson(result)
    }
}

function downloadJson(result: PatchEditLatencyBenchmarkResult): void {
    const safeLabel = result.label ? `-${sanitizeFilePart(result.label)}` : ''
    const fileName = `patch-edit-latency-${result.finalCellCount}-cells${safeLabel}.json`
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
