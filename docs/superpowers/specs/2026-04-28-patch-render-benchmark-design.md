# Patch Render Benchmark Design

## Goal

Add a dev-only benchmark mode for collecting patch editor rendering metrics for paper figures. The benchmark focuses on render throughput and frame-time stability, not edit-operation latency.

## Scope

The benchmark measures two workloads:

- `static`: continuously requests repaint while the map camera remains fixed.
- `navigation`: continuously requests repaint while running a deterministic camera animation.

Both workloads collect frame timestamps from patch topology rendering and export JSON summaries that can be used to plot FPS and frame-time percentile curves across patch sizes.

## Activation

The benchmark is activated by URL parameters in the web client:

- `?benchmark=patch-render`
- `?benchmark=patch-render&benchmarkWorkload=static`
- `?benchmark=patch-render&benchmarkWorkload=navigation`

Optional parameters:

- `benchmarkDurationMs`: measurement window, default `10000`.
- `benchmarkWarmupMs`: warm-up window discarded from metrics, default `3000`.
- `benchmarkLabel`: label copied into the exported JSON.
- `benchmarkExport`: `download`, `console`, or `both`; default `both`.

## Metrics

The exported JSON includes:

- workload metadata: workload, duration, warm-up, viewport, device pixel ratio, user agent, timestamp, patch id, cell count.
- throughput metrics: total measured frames, total measured time, mean FPS.
- frame-time metrics: mean, median, p95, p99, min, max, and counts over 16.7 ms, 33.3 ms, and 50 ms.

The benchmark records frame times only for frames where `TopologyLayer.render()` actually executes for the active patch. This avoids counting unrelated React or Mapbox frames when the patch layer is not ready.

## Integration

`TopologyLayer` exposes a small render-observer API. The benchmark runner subscribes after patch context loading completes in `PatchEdit`, drives repaint with `requestAnimationFrame`, optionally animates the camera, and stops after warm-up plus measurement duration.

The implementation intentionally avoids GPU timer queries in the first version. Browser and driver support varies, and paper-facing frame-time data is sufficient when the hardware and software environment is reported.

## Non-Goals

- No CI gate.
- No automated patch creation.
- No brush, box selection, subdivision, merge, delete, or recovery timing.
- No production UI.
