# Patch Render Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dev-only patch render benchmark mode that exports paper-ready FPS and frame-time statistics.

**Architecture:** Add a focused benchmark module under `template/patch/benchmark` for URL parsing, frame statistics, benchmark lifecycle, and JSON export. `TopologyLayer` emits render samples through a small observer API, and `PatchEdit` starts the runner after the patch layer is ready.

**Tech Stack:** TypeScript, React, Vite, Mapbox GL JS, WebGL2 custom layer rendering.

---

### Task 1: Add Frame Statistics Module

**Files:**
- Create: `client/src/src/template/patch/benchmark/renderBenchmarkStats.ts`

- [ ] **Step 1: Write a standalone failing Node test**

Create a temporary script at `/tmp/gridmen-render-benchmark-stats-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('client/src/src/template/patch/benchmark/renderBenchmarkStats.ts', 'utf8')

assert.match(source, /export function summarizeFrameSamples/)
assert.match(source, /p95FrameMs/)
assert.match(source, /framesOver33Ms/)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node /tmp/gridmen-render-benchmark-stats-test.mjs`

Expected: FAIL with `ENOENT` because the stats module does not exist yet.

- [ ] **Step 3: Implement statistics helpers**

Create `client/src/src/template/patch/benchmark/renderBenchmarkStats.ts` with percentile and summary functions.

- [ ] **Step 4: Run the standalone test again**

Run: `node /tmp/gridmen-render-benchmark-stats-test.mjs`

Expected: PASS.

### Task 2: Add Benchmark Runner

**Files:**
- Create: `client/src/src/template/patch/benchmark/renderBenchmarkRunner.ts`
- Modify: `client/src/src/template/patch/benchmark/renderBenchmarkStats.ts`

- [ ] **Step 1: Write a standalone failing Node test**

Create `/tmp/gridmen-render-benchmark-runner-test.mjs` that checks the runner file contains `parsePatchRenderBenchmarkConfig`, `startPatchRenderBenchmark`, `benchmarkDurationMs`, and `benchmarkWorkload`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node /tmp/gridmen-render-benchmark-runner-test.mjs`

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Implement runner**

The runner should parse URL parameters, subscribe to `TopologyLayer` render samples, drive continuous repaint, optionally animate the camera, and export a JSON result through console and/or file download.

- [ ] **Step 4: Run the standalone test again**

Run: `node /tmp/gridmen-render-benchmark-runner-test.mjs`

Expected: PASS.

### Task 3: Wire Benchmark Into Patch Rendering

**Files:**
- Modify: `client/src/src/views/mapView/topology/TopologyLayer.ts`
- Modify: `client/src/src/template/patch/patchEdit.tsx`

- [ ] **Step 1: Write a standalone failing source assertion**

Create `/tmp/gridmen-render-benchmark-wiring-test.mjs` that checks `TopologyLayer.ts` contains `addRenderSampleListener`, `removeRenderSampleListener`, and `emitRenderSample`, and checks `patchEdit.tsx` imports and calls `startPatchRenderBenchmark`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node /tmp/gridmen-render-benchmark-wiring-test.mjs`

Expected: FAIL because the source wiring is not present.

- [ ] **Step 3: Add render observer API**

Add listener registration to `TopologyLayer`. Emit one sample at the end of each rendered frame with timestamp, render duration, cell count, visibility, layer id, and pass count.

- [ ] **Step 4: Start benchmark after patch ready**

In `PatchEdit.loadContext`, call `startPatchRenderBenchmark` after the topology layer and patch core are ready. Store cleanup in the node cleanup context and invoke it during unload.

- [ ] **Step 5: Run the wiring test again**

Run: `node /tmp/gridmen-render-benchmark-wiring-test.mjs`

Expected: PASS.

### Task 4: Document Usage and Verify

**Files:**
- Create: `docs/benchmark/patch-render-benchmark.md`
- Modify: `docs/superpowers/specs/2026-04-28-patch-render-benchmark-design.md`

- [ ] **Step 1: Write usage documentation**

Document URL parameters, workloads, output schema, and suggested paper figures.

- [ ] **Step 2: Run TypeScript build**

Run: `npm run build` from `client/src`.

Expected: build exits 0.

- [ ] **Step 3: Run lint**

Run: `npm run lint` from `client/src`.

Expected: lint exits 0 or only reports pre-existing unrelated issues.
