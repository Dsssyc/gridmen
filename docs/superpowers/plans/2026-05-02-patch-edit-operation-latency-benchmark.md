# Patch Edit Operation Latency Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dev-only benchmark mode that measures end-to-end latency for core patch editing operations.

**Architecture:** Reuse the existing patch benchmark area and add a separate edit-latency runner. `PatchEdit` starts either the render benchmark or the edit benchmark based on URL params. `TopologyLayer` exposes narrow benchmark helpers that select deterministic storage ids, run existing edit operations, and resolve after the next topology render.

**Tech Stack:** TypeScript, React, Mapbox GL custom layers, WebGL2, existing `PatchCore` and `TopologyLayer` APIs, shell-driven Node tests for pure benchmark logic.

---

### Task 1: Add Edit Latency Summary Logic

**Files:**
- Create: `client/src/src/template/patch/benchmark/editLatencyStats.ts`

- [ ] **Step 1: Write failing behavior test**

Run a Node test that expects a missing module to export latency summary helpers:

```bash
node /tmp/gridmen-edit-latency-stats-test.mjs
```

Expected before implementation: FAIL because `editLatencyStats.js` does not exist.

- [ ] **Step 2: Implement summary helper**

Create `editLatencyStats.ts` with exported `summarizeEditLatencyTrials`, `percentile`, and type definitions.

- [ ] **Step 3: Verify summary behavior**

Run:

```bash
node /tmp/gridmen-edit-latency-stats-test.mjs
```

Expected after implementation: PASS.

### Task 2: Add Edit Latency Runner

**Files:**
- Create: `client/src/src/template/patch/benchmark/editLatencyBenchmarkRunner.ts`

- [ ] **Step 1: Write failing runner test**

Run:

```bash
node /tmp/gridmen-edit-latency-runner-test.mjs
```

Expected before implementation: FAIL because the runner does not exist.

- [ ] **Step 2: Implement config parsing and sequential trial execution**

Add URL parsing for `?benchmark=patch-edit-latency`, operation filtering, trial count, warm-up frame count, export mode, and JSON export.

- [ ] **Step 3: Verify runner behavior**

Run:

```bash
node /tmp/gridmen-edit-latency-runner-test.mjs
```

Expected after implementation: PASS.

### Task 3: Add TopologyLayer Benchmark Operation Hooks

**Files:**
- Modify: `client/src/src/views/mapView/topology/TopologyLayer.ts`

- [ ] **Step 1: Add narrow benchmark API**

Expose `runBenchmarkEditOperation(operation)` and `waitForBenchmarkRenderFrame()` while keeping existing UI operations unchanged.

- [ ] **Step 2: Reuse existing edit methods**

The benchmark API selects deterministic storage ids and calls existing `executeSubdivideCells`, `executeMergeCells`, `executeDeleteCells`, and `executeRecoverCells` methods. It resolves only after the next emitted render sample.

- [ ] **Step 3: Type-check TopologyLayer**

Run focused TypeScript compilation.

### Task 4: Wire Benchmark Into PatchEdit

**Files:**
- Modify: `client/src/src/template/patch/patchEdit.tsx`
- Modify: `docs/benchmark/patch-render-benchmark.md` or add edit benchmark docs

- [ ] **Step 1: Start edit benchmark from PatchEdit**

Call `startPatchEditLatencyBenchmark` after topology layer initialization, using the same cleanup slot as the render benchmark.

- [ ] **Step 2: Document activation**

Document:

```text
?benchmark=patch-edit-latency
```

with trial and operation options.

- [ ] **Step 3: Verify focused compile**

Run TypeScript compile for changed benchmark files and focused lint where feasible.

### Task 5: Final Verification

**Files:**
- All touched files

- [ ] **Step 1: Run Node behavior tests**

Run stats and runner behavior tests.

- [ ] **Step 2: Run focused TypeScript checks**

Run `tsc` against the touched TypeScript surface.

- [ ] **Step 3: Report any full-build limitations**

If full build or lint has unrelated existing failures, report that rather than claiming clean global status.
