# Patch Edit Operation Latency Benchmark Design

## Goal

Add a dev-only benchmark mode for collecting paper-facing latency metrics for core patch editing operations. The benchmark focuses on user-perceived operation latency after a patch is loaded and rendered. It complements the existing patch render benchmark, which measures navigation frame-rate stability rather than editing responsiveness.

The benchmark should support Section 4.5 by answering one question:

> Once a large patch is ready for interaction, can the editor complete local editing operations within an interactive latency range?

## Scope

The benchmark measures the core editing chain:

- `pick`
- `subdivide`
- `merge`
- `delete`
- `recover`

Each operation is measured through the real frontend editing path:

1. trigger the operation from a deterministic benchmark runner
2. execute the existing `TopologyLayer` and `PatchCore` operation
3. include worker or backend round trips that the operation normally requires
4. include GPU buffer updates
5. stop timing after the next rendered topology frame confirms the operation has reached the visual layer

The benchmark excludes initial patch loading, topology preparation, GPU buffer initialization, camera navigation throughput, and full scenario assembly.

## Chosen Approach

Use end-to-end user-perceived latency as the main paper metric.

For each patch scale and operation type, run a deterministic sequence of operation trials. Export raw per-trial timing records plus summary statistics. The paper table should report median and p95 latency per operation. Internal phase timings can be recorded for debugging, but they should not be required for the main paper table.

This approach is preferred over stage-level profiling because it directly supports the paper claim about interactive patch editing without making the section depend on implementation-specific timing categories.

## Experimental Scales

Use three patch scales:

| Scale | Cell count target | Purpose |
|---|---:|---|
| Medium | approximately 500k cells | common sub-million editing case |
| Large | approximately 1.0M to 1.6M cells | main claimed interactive operating range |
| Stress | approximately 16.5M cells | upper-bound stress case, not a pass/fail target |

The benchmark should record the actual `cellCount` before every trial because subdivision, merge, delete, and recovery can change the active cell count.

## Operations

### Pick

Measures selection latency.

Timing boundary:

- start: benchmark triggers a deterministic brush or direct storage-id selection
- stop: the next rendered topology frame after the selected cell highlight has been sent to the GPU

Primary output:

- latency in milliseconds
- selected cell count
- target storage id or target key

### Subdivide

Measures local refinement latency.

Timing boundary:

- start: benchmark triggers subdivision for a deterministic, valid, undeleted target cell
- stop: the next rendered topology frame after new child cell render data has been uploaded

Primary output:

- latency in milliseconds
- input selected cell count
- output added child count
- cell count before and after

### Merge

Measures local coarsening latency.

Timing boundary:

- start: benchmark triggers merge for a deterministic sibling group
- stop: the next rendered topology frame after the parent representation has been uploaded

Primary output:

- latency in milliseconds
- input sibling count
- output parent count
- cell count before and after

### Delete

Measures logical deletion latency.

Timing boundary:

- start: benchmark triggers delete for a deterministic selected cell set
- stop: the next rendered topology frame after deleted flags are uploaded and visible

Primary output:

- latency in milliseconds
- deleted cell count
- cell count before and after

### Recover

Measures logical recovery latency.

Timing boundary:

- start: benchmark triggers recovery for the cells deleted by the paired delete trial
- stop: the next rendered topology frame after recovered flags are uploaded and visible

Primary output:

- latency in milliseconds
- recovered cell count
- cell count before and after

## Trial Design

Run 30 trials per operation per patch scale.

Rules:

- warm up the editor with at least one stable rendered topology frame before starting operation trials
- wait for one stable frame between trials
- use deterministic targets so runs are comparable
- avoid random screen coordinates as the primary target mechanism
- ensure `subdivide` targets are valid, undeleted, and below max level
- ensure `merge` targets form valid sibling groups
- pair `delete` and `recover` so recovery restores cells deleted by the previous delete trial
- record failed trials explicitly instead of silently dropping them

The benchmark should allow fewer trials through a URL parameter for local smoke testing, but the paper-facing default should remain 30 trials.

## Activation

Use a separate benchmark mode so render and edit latency data are not mixed:

```text
?benchmark=patch-edit-latency
```

Optional parameters:

- `benchmarkTrials`: number of trials per operation, default `30`
- `benchmarkWarmupFrames`: stable rendered frames before measurement, default `3`
- `benchmarkOperation`: `all`, `pick`, `subdivide`, `merge`, `delete`, or `recover`; default `all`
- `benchmarkLabel`: copied into exported JSON
- `benchmarkExport`: `download`, `console`, or `both`; default `both`

## Exported JSON

The exported JSON should include:

- benchmark metadata: benchmark name, label, patch id, started timestamp, viewport, device pixel ratio, user agent
- patch metadata: initial cell count, final cell count, max level if available
- benchmark config: trials, warm-up frames, operation filter
- per-trial records:
  - operation
  - trial index
  - success or failure
  - failure reason, if any
  - latency milliseconds
  - cell count before
  - cell count after
  - target metadata
  - selected cell count
- summary per operation:
  - successful trial count
  - failed trial count
  - mean latency
  - median latency
  - p95 latency
  - p99 latency
  - min latency
  - max latency

## Paper Table

The main table should report only operation latency metrics:

| Cells | Pick p50 | Pick p95 | Subdivide p50 | Subdivide p95 | Merge p50 | Merge p95 | Delete p50 | Delete p95 | Recover p50 | Recover p95 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|

The paper text should interpret the medium and large scales as the practical interactive operating range. The stress scale should be described as an upper-bound test, consistent with the existing navigation benchmark.

## Integration

Add a benchmark runner under the existing patch benchmark area. The runner should be started from `PatchEdit` after the active `TopologyLayer` is initialized and the first valid topology render has occurred.

`TopologyLayer` should expose benchmark-safe async wrappers or completion hooks for the measured operations. The wrappers should resolve only after operation completion and one subsequent topology render. Existing UI behavior should not change.

The benchmark should avoid directly mutating private state unless no public operation boundary exists. If new hooks are needed, keep them narrow and dev-only where possible.

## Verification

Verification should cover:

1. unit-level summary-statistics tests for latency aggregation
2. runner tests with fake operation hooks to confirm sequencing, failure recording, and summary output
3. an in-browser smoke run on a small patch with `benchmarkTrials=1`
4. a paper-facing run on the selected patch scales with `benchmarkTrials=30`

For the paper-facing run, confirm:

- no timing starts before the patch is ready
- every reported trial has a visual completion frame
- failed trials are visible in the JSON
- summary statistics are computed from successful trials only

## Risks

- Repeated edit operations mutate patch state, so trial order must be deterministic and reversible where possible.
- Merge requires valid sibling groups; target generation must not rely on arbitrary random cells.
- Backend or worker persistence can make repeated subdivision/delete operations affect later trials.
- Measuring visual completion requires careful render-frame gating to avoid stopping at operation callback completion before the user-visible update.
- Stress-scale edit latency may be dominated by full-frame rendering rather than local data mutation; the paper should label it as a stress case.

## Non-Goals

- measuring initial patch loading time
- measuring navigation FPS or frame-time stability
- measuring full scenario assembly or simulation runtime
- redesigning edit operations for performance
- adding production UI for benchmark controls
- changing backend data formats or patch semantics
