# Assembly Recording Optimization

**Date**: 2026-04-23
**Status**: Approved (pending user spec review)

## Problem

The current assembly bottleneck is no longer vector adjustment. It is topology recording:

- `assembly.record_cell_topology`: 46.12s
- `assembly.record_edge_topology`: 84.61s
- combined: 130.73s

From the latest benchmark, topology recording now consumes:

- 66.39% of total `MOUNT`
- 76.70% of `assembly.compile`

The existing logs only show coarse totals for cell and edge recording. They do not reveal how much time is spent on:

- batch construction
- multiprocessing orchestration
- DEM sampling
- LUM sampling
- record packing
- parent-process file writing

That makes it hard to distinguish whether the main cost comes from Python packing, raster sampling, or process overhead.

## Scope

This optimization round is intentionally **low risk first**.

In scope:

- add fine-grained timing inside topology recording
- expose DEM and LUM sampling as separate timings
- remove obvious repeated work in the cell and edge record hot paths
- optimize record packing without changing output format
- keep current batch-based multiprocessing structure

Out of scope:

- redesigning multiprocessing architecture
- changing `spawn` / IPC strategy
- changing binary file format
- changing the topology algorithm itself
- changing higher-level assembly flow

## Root Cause Hypothesis

Based on code inspection and benchmark shape, the likely cost centers are:

1. repeated Python-side decode / coordinate computation per record
2. repeated per-record packing overhead, especially in cell records
3. optional DEM/LUM raster sampling hidden inside worker totals
4. parent/worker overhead that is currently invisible because timing is too coarse

The current implementation also recomputes some information twice:

- cell workers decode `key` and compute coordinates before sampling, then `_generate_cell_record()` decodes `key` and computes coordinates again
- edge workers unpack edge geometry before sampling, then `_generate_edge_record()` unpacks and reconstructs coordinates again

These duplicate operations occur millions of times and are strong low-risk optimization targets.

## Chosen Approach

Use a **two-layer optimization**:

1. **Instrument first** — split recording into smaller timed phases so DEM/LUM and packing costs become visible
2. **Optimize the obvious hot path** — remove duplicate decode / coordinate work and replace the slowest Python packing patterns with tighter packing logic

This keeps behavior stable while producing better evidence for any later, more aggressive redesign.

## Detailed Design

### 1. Fine-grained timing

Add timing for these phases:

#### Cell recording

- `record.cell.build_batch_args`
- `record.cell.pool_total`
- `record.cell.parent_write`
- `record.cell.worker_total`
- `record.cell.worker.raster_open`
- `record.cell.worker.dem_sample`
- `record.cell.worker.lum_sample`
- `record.cell.worker.pack`

#### Edge recording

- `record.edge.build_batch_args`
- `record.edge.pool_total`
- `record.edge.parent_write`
- `record.edge.worker_total`
- `record.edge.worker.raster_open`
- `record.edge.worker.dem_sample`
- `record.edge.worker.lum_sample`
- `record.edge.worker.pack`

Additional debug fields should indicate whether DEM/LUM are enabled for the current run so the logs can be interpreted correctly.

### 2. Cell hot-path cleanup

Refactor the cell record path so worker code computes the geometry once and record generation consumes precomputed values.

Current pattern:

1. worker unpacks key
2. worker computes coordinates
3. worker samples DEM/LUM
4. `_generate_cell_record()` unpacks key again
5. `_generate_cell_record()` computes coordinates again
6. `_generate_cell_record()` loops field-by-field over `struct.pack`

New pattern:

1. worker unpacks key once
2. worker computes coordinates once
3. worker samples DEM/LUM
4. worker passes precomputed values into a record builder
5. record builder packs directly without re-decoding the key

This preserves output shape while removing duplicated work.

### 3. Edge hot-path cleanup

Apply the same idea to edges:

Current pattern:

1. worker unpacks edge bytes
2. worker reconstructs coordinates
3. worker samples DEM/LUM
4. `_generate_edge_record()` unpacks edge bytes again
5. `_generate_edge_record()` reconstructs coordinates again

New pattern:

1. worker unpacks edge bytes once
2. worker computes coordinates once
3. worker samples DEM/LUM
4. record builder uses those values directly

### 4. Packing optimization

The current cell path packs values in a Python loop, one field at a time. Replace that with a tighter strategy:

- construct the packed header in one or a few `struct.pack(...)` calls
- pack edge index lists in grouped form instead of branching per field
- keep the binary schema unchanged

For edge records, the current single-call `struct.pack(...)` is already better, so the main gain there is removing duplicate unpack / coordinate work.

### 5. DEM/LUM sampling visibility

DEM and LUM are optional user inputs. The new timing must make that explicit.

Requirements:

- if DEM is absent, `dem_sample` timing should be zero or absent in a clearly interpretable way
- if LUM is absent, `lum_sample` timing should be zero or absent in a clearly interpretable way
- raster open cost should be timed separately from raster sample cost
- sampling counts should be logged so the total time can be interpreted against actual work volume

This turns DEM/LUM from a hidden cost into a directly inspectable cost center.

## Files to Change

- `server/templates/grid/assembly.py`
  - add fine-grained timing inside recording stages
  - refactor cell record builder to consume precomputed geometry
  - refactor edge record builder to consume precomputed geometry
  - separate raster-open / DEM-sample / LUM-sample / pack timings

## Verification

1. Run targeted tests for record generation helpers and recording orchestration.
2. Run a benchmark mount with the same dataset as the recent timing run.
3. Confirm logs now show:
   - cell and edge internal sub-phases
   - DEM sampling time separately from LUM sampling time
   - parent write time separately from worker time
4. Compare new totals against the current benchmark to see whether the low-risk hot-path cleanup produces measurable gains.

## Risks

- Adding too much per-record logging would distort timing; only phase-level timing should be added
- Over-optimizing packing while preserving exact binary layout requires careful verification
- DEM/LUM timing must not change sampling semantics

## Non-Goals

- replacing multiprocessing with a new execution model
- moving to shared memory
- rewriting topology recording in NumPy or C extensions
- changing downstream file consumers
