export type EditLatencyOperation = 'pick' | 'subdivide' | 'merge' | 'delete' | 'recover'

export interface EditLatencyTrial {
    operation: EditLatencyOperation
    trialIndex: number
    success: boolean
    failureReason?: string
    latencyMs?: number
    cellCountBefore: number
    cellCountAfter: number
    selectedCellCount: number
    target?: Record<string, unknown>
}

export interface EditLatencyOperationSummary {
    successfulTrialCount: number
    failedTrialCount: number
    meanLatencyMs: number
    medianLatencyMs: number
    p95LatencyMs: number
    p99LatencyMs: number
    minLatencyMs: number
    maxLatencyMs: number
}

export type EditLatencySummary = Partial<Record<EditLatencyOperation, EditLatencyOperationSummary>>

export function summarizeEditLatencyTrials(trials: EditLatencyTrial[]): EditLatencySummary {
    const operations = Array.from(new Set(trials.map(trial => trial.operation)))
    const summary: EditLatencySummary = {}

    for (const operation of operations) {
        const operationTrials = trials.filter(trial => trial.operation === operation)
        const successfulLatencies = operationTrials
            .filter(trial => trial.success)
            .map(trial => trial.latencyMs)
            .filter((latency): latency is number => (
                latency !== undefined && Number.isFinite(latency) && latency >= 0
            ))

        summary[operation] = {
            successfulTrialCount: successfulLatencies.length,
            failedTrialCount: operationTrials.length - successfulLatencies.length,
            meanLatencyMs: mean(successfulLatencies),
            medianLatencyMs: percentile(successfulLatencies, 0.5),
            p95LatencyMs: percentile(successfulLatencies, 0.95),
            p99LatencyMs: percentile(successfulLatencies, 0.99),
            minLatencyMs: successfulLatencies.length ? Math.min(...successfulLatencies) : 0,
            maxLatencyMs: successfulLatencies.length ? Math.max(...successfulLatencies) : 0,
        }
    }

    return summary
}

export function percentile(values: number[], quantile: number): number {
    if (values.length === 0) return 0

    const sorted = [...values].sort((a, b) => a - b)
    const clampedQuantile = Math.min(Math.max(quantile, 0), 1)
    const index = (sorted.length - 1) * clampedQuantile
    const lowerIndex = Math.floor(index)
    const upperIndex = Math.ceil(index)

    if (lowerIndex === upperIndex) return sorted[lowerIndex]

    const weight = index - lowerIndex
    return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight
}

function mean(values: number[]): number {
    if (values.length === 0) return 0
    return values.reduce((sum, value) => sum + value, 0) / values.length
}
