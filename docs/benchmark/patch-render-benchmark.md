# Patch Render Benchmark

This benchmark collects paper-facing rendering metrics for the patch editor. It measures topology rendering throughput and frame-time stability, not edit-operation latency.

## Activation

Open a patch in edit mode and add URL parameters to the web client:

```text
?benchmark=patch-render
```

The default workload is `static`. To run camera navigation:

```text
?benchmark=patch-render&benchmarkWorkload=navigation
```

Useful options:

```text
benchmarkDurationMs=10000
benchmarkWarmupMs=3000
benchmarkLabel=small-10k-run-1
benchmarkExport=both
```

`benchmarkExport` accepts `console`, `download`, or `both`.

## Workloads

- `static`: keeps the current camera fixed and continuously requests repaint during the measurement window.
- `navigation`: continuously requests repaint while applying a deterministic camera motion around the current view.

Both workloads ignore warm-up samples and only record frames where the active `TopologyLayer` renders.

The benchmark arms itself when the patch editor is mounted, but it does not start the warm-up or measurement window until the first valid `TopologyLayer` render sample is emitted. This avoids including large-patch data loading, initial topology preparation, and GPU buffer initialization in the FPS measurement. The excluded wait is recorded as `readinessWaitMs` in the exported JSON.

## Output

The exported JSON includes:

- `workload`
- `label`
- `patchId`
- `cellCount`
- `readinessWaitMs`
- `durationMs`
- `warmupMs`
- `viewport.width`
- `viewport.height`
- `viewport.devicePixelRatio`
- `environment.userAgent`
- `summary.meanFps`
- `summary.medianFrameMs`
- `summary.p95FrameMs`
- `summary.p99FrameMs`
- `summary.framesOver16Ms`
- `summary.framesOver33Ms`
- `summary.framesOver50Ms`
- raw `samples`

## Suggested Paper Figures

Use two primary plots:

- FPS vs. cell count, with separate series for `static` and `navigation`.
- p95 frame time vs. cell count, with reference lines at 16.7 ms and 33.3 ms.

Report the hardware and software environment with the results:

- CPU, GPU, RAM.
- Browser or Electron version.
- Viewport resolution.
- Device pixel ratio.
- Mapbox style/base layer used during measurements.
- Patch cell count and level distribution.

Repeat each data point at least five times and report mean plus standard deviation or confidence intervals.

# Patch Edit Latency Benchmark

This benchmark collects paper-facing operation latency metrics for the patch editor. It measures core edit-operation responsiveness after the active patch has already loaded and rendered. It does not measure initial patch loading, camera navigation FPS, full scenario assembly, or simulation runtime.

## Activation

Open a patch in edit mode and add URL parameters to the web client:

```text
?benchmark=patch-edit-latency
```

Useful options:

```text
benchmarkTrials=30
benchmarkWarmupFrames=3
benchmarkOperation=all
benchmarkLabel=500k-edit-run-1
benchmarkExport=both
```

`benchmarkOperation` accepts `all`, `pick`, `subdivide`, `merge`, `delete`, or `recover`.

`benchmarkExport` accepts `console`, `download`, or `both`.

## Workloads

The benchmark runs deterministic edit-operation trials against the active `TopologyLayer`:

- `pick`: selects one deterministic, undeleted storage id.
- `subdivide`: selects one deterministic, subdividable cell and uploads the generated child cells.
- `merge`: merges the child group created by the paired subdivision trial, or falls back to a deterministic valid sibling group.
- `delete`: marks one deterministic, undeleted cell as deleted.
- `recover`: restores the cell deleted by the paired delete trial.

Each trial starts timing immediately before the operation is triggered and stops only after the next topology render sample is emitted after the operation has updated GPU-visible state.

## Output

The exported JSON includes:

- `benchmark`
- `label`
- `patchId`
- `startedAt`
- `initialCellCount`
- `finalCellCount`
- `readinessWaitMs`
- `config.trials`
- `config.warmupFrames`
- `config.operation`
- `viewport.width`
- `viewport.height`
- `viewport.devicePixelRatio`
- `environment.userAgent`
- raw per-operation `trials`
- per-operation `summary`

Each trial records:

- `operation`
- `trialIndex`
- `success`
- `failureReason`, when the trial failed
- `latencyMs`, when the trial succeeded
- `cellCountBefore`
- `cellCountAfter`
- `selectedCellCount`
- `target`

## Suggested Paper Table

Use median and p95 operation latency:

| Cells | Pick p50 | Pick p95 | Subdivide p50 | Subdivide p95 | Merge p50 | Merge p95 | Delete p50 | Delete p95 | Recover p50 | Recover p95 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|

Interpret medium and large patch scales as the practical interactive operating range. Treat ten-million-cell results as stress cases, consistent with the navigation rendering benchmark.
