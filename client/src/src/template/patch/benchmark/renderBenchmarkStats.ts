import type { TopologyRenderSample } from '@/views/mapView/topology/renderSample'

export type RenderFrameSample = TopologyRenderSample

export interface RenderFrameSummary {
    sampleCount: number
    frameCount: number
    measuredTimeMs: number
    meanFps: number
    meanFrameMs: number
    medianFrameMs: number
    p95FrameMs: number
    p99FrameMs: number
    minFrameMs: number
    maxFrameMs: number
    framesOver16Ms: number
    framesOver33Ms: number
    framesOver50Ms: number
    meanRenderDurationMs: number
    p95RenderDurationMs: number
    p99RenderDurationMs: number
}

export function summarizeFrameSamples(samples: RenderFrameSample[]): RenderFrameSummary {
    if (samples.length < 2) {
        return {
            sampleCount: samples.length,
            frameCount: 0,
            measuredTimeMs: 0,
            meanFps: 0,
            meanFrameMs: 0,
            medianFrameMs: 0,
            p95FrameMs: 0,
            p99FrameMs: 0,
            minFrameMs: 0,
            maxFrameMs: 0,
            framesOver16Ms: 0,
            framesOver33Ms: 0,
            framesOver50Ms: 0,
            meanRenderDurationMs: 0,
            p95RenderDurationMs: 0,
            p99RenderDurationMs: 0,
        }
    }

    const sortedSamples = [...samples].sort((a, b) => a.timestampMs - b.timestampMs)
    const frameTimes = new Array<number>()

    for (let i = 1; i < sortedSamples.length; i += 1) {
        const frameTime = sortedSamples[i].timestampMs - sortedSamples[i - 1].timestampMs
        if (Number.isFinite(frameTime) && frameTime >= 0) {
            frameTimes.push(frameTime)
        }
    }

    const renderDurations = sortedSamples
        .map(sample => sample.renderDurationMs)
        .filter(duration => Number.isFinite(duration) && duration >= 0)

    const measuredTimeMs = sortedSamples[sortedSamples.length - 1].timestampMs - sortedSamples[0].timestampMs
    const frameCount = frameTimes.length
    const meanFps = measuredTimeMs > 0 ? frameCount / (measuredTimeMs / 1000) : 0

    return {
        sampleCount: sortedSamples.length,
        frameCount,
        measuredTimeMs,
        meanFps,
        meanFrameMs: mean(frameTimes),
        medianFrameMs: percentile(frameTimes, 0.5),
        p95FrameMs: percentile(frameTimes, 0.95),
        p99FrameMs: percentile(frameTimes, 0.99),
        minFrameMs: frameTimes.length ? Math.min(...frameTimes) : 0,
        maxFrameMs: frameTimes.length ? Math.max(...frameTimes) : 0,
        framesOver16Ms: countOver(frameTimes, 16.7),
        framesOver33Ms: countOver(frameTimes, 33.3),
        framesOver50Ms: countOver(frameTimes, 50),
        meanRenderDurationMs: mean(renderDurations),
        p95RenderDurationMs: percentile(renderDurations, 0.95),
        p99RenderDurationMs: percentile(renderDurations, 0.99),
    }
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

function countOver(values: number[], threshold: number): number {
    return values.reduce((count, value) => count + (value > threshold ? 1 : 0), 0)
}
