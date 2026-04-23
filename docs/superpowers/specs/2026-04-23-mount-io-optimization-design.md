# Grid Mount In-Memory NE/NS Handoff

**Date**: 2026-04-23
**Status**: Approved (pending user spec review)

## Problem

The current grid `MOUNT` pipeline does unnecessary text I/O between assembly and vector adjustment:

1. assembly writes `cell_topo.bin` and `edge_topo.bin`
2. mount loads them into `HydroElements` / `HydroSides`
3. mount exports `ne.txt` / `ns.txt`
4. vector immediately reads `ne.txt` / `ns.txt` back into `NeData` / `NsData`
5. vector modifies them and writes `ne.txt` / `ns.txt` again

From the benchmark captured on 2026-04-22, this path is high ROI:

- `assembly.load_topology`: 8.53s
- `assembly.export_ne_ns_text`: 7.57s
- `vector.read_ne`: 7.57s
- `vector.read_ns`: 11.67s
- `vector.write_ne`: 2.81s
- `vector.write_ns`: 4.10s

The expensive part is not the vector math itself. The expensive part is converting the same topology through multiple on-disk formats inside one mount.

## Scope

This optimization is intentionally limited to a **single `MOUNT` execution**.

In scope:

- keep topology/model data in memory between assembly and vector adjustment
- avoid the intermediate `ne.txt` / `ns.txt` export-readback cycle
- persist final `ne.txt` / `ns.txt` once at the end of mount
- preserve the existing file outputs for export APIs and downstream tooling
- add timing logs around the new in-memory handoff and final persistence
- disable block generation for now because it is visualization-oriented and currently unused

Out of scope:

- cross-request or process-global caches
- changing vector modification semantics
- changing `cell_topo.bin` / `edge_topo.bin` binary generation
- redesigning block generation

## Root Cause

The current implementation treats `ne.txt` / `ns.txt` as both:

- the mount-time working format for vector adjustment
- the persisted export format for later use

That forces a lossy and expensive pipeline inside one request:

`binary topology -> text export -> text parse -> numpy processing -> text export`

But during one `MOUNT`, the request already has the needed topology objects in memory. The text files are only needed as the final persisted artifact, not as the temporary working format.

## Chosen Approach

Use **in-memory handoff + final single write**.

### Summary

1. `_handle_assembly()` returns a mount-local context instead of only producing files.
2. The context contains:
   - `HydroElements`
   - `HydroSides`
   - `model_data` in the existing `NeData` / `NsData` shape used by vector logic
3. `_handle_vector_modification()` accepts optional in-memory `model_data`.
4. If in-memory data is provided, vector logic uses it directly and skips `vector.read_ne` / `vector.read_ns`.
5. After vector finishes, mount writes `ne.txt` / `ns.txt` exactly once.
6. If mount is called without assembly but with vector, the old file-based path remains as a fallback.

### Why this approach

- It removes the most expensive redundant I/O without rewriting the vector algorithm.
- It keeps the persisted `ne.txt` / `ns.txt` contract intact.
- It preserves a safe fallback for vector-only mount paths.
- It does not introduce process-wide cache invalidation problems.

## Detailed Design

### 1. Mount-local assembly result

Introduce a small mount-local result structure in `server/templates/grid/hooks.py` (or a nearby helper module) to carry:

- `ne_topology: HydroElements`
- `ns_topology: HydroSides`
- `model_data: dict[str, NeData | NsData]`

This object lives only for the duration of the current `MOUNT`.

### 2. Build `model_data` from topology objects

Add a conversion helper that constructs the existing vector input shape directly from `HydroElements.es` and `HydroSides.ss`.

Requirements:

- preserve the current 1-based placeholder convention at index `0`
- preserve all fields currently consumed by `apply_vector_modification()`
- keep integer fields integer-like on writeback
- avoid changing vector behavior or masks

This replaces the current path:

`HydroElements/HydroSides -> export text -> parse text -> NeData/NsData`

with:

`HydroElements/HydroSides -> NeData/NsData`

### 3. Assembly flow change

`_handle_assembly()` should:

1. run `assembly(...)` as today
2. load `HydroElements` / `HydroSides` from binary files as today
3. build in-memory `model_data`
4. return the mount-local result

It should **not** export `ne.txt` / `ns.txt` immediately anymore.

### 4. Vector flow change

`_handle_vector_modification()` should accept an optional `model_data` argument.

Behavior:

- if `model_data` is provided, skip `get_ne()` and `get_ns()`
- if `model_data` is absent, keep the existing file-based fallback
- after `apply_vector_modification()`, return the modified model data to the caller

This keeps vector semantics stable while allowing a fast path for assembly+vector mounts.

### 5. Final persistence

At the end of `MOUNT`, after vector modification if present, write:

- `ne.txt`
- `ns.txt`

exactly once from the latest `model_data`.

Persistence rules:

- assembly + no vector: write once from assembly-produced in-memory data
- assembly + vector: write once from vector-modified in-memory data
- vector-only: keep current read-modify-write file fallback

### 6. Block generation

Disable block generation for now in `_handle_assembly()`.

Reason:

- it is currently unused
- it is visualization-oriented
- it should not stay on the critical path while mount performance is being optimized

The code can be commented out or guarded behind a disabled branch, but the current mount path should not invoke it.

## Logging and Benchmarking

Keep the current timing style and add new timings:

- `mount.build_model_data_from_topology`
- `mount.persist_ne_ns_once`
- `mount.vector_input source=in_memory|file`

Expected benchmark effect:

- remove `assembly.export_ne_ns_text`
- remove `vector.read_ne`
- remove `vector.read_ns`
- keep one final `write_ne` + `write_ns`

This should materially reduce `MOUNT.vector` and total `MOUNT` duration for assembly+vector jobs.

## Error Handling

- If assembly succeeds but topology-to-model conversion fails, mount fails loudly.
- If vector modification fails, mount fails loudly and does not pretend persistence succeeded.
- Fallback file path remains available only when no in-memory model data is supplied.

No silent fallback from in-memory fast path to file path should be added for conversion errors; failures should stay visible during optimization.

## Files to Change

- `server/templates/grid/hooks.py`
  - return mount-local assembly result
  - pass in-memory model data into vector stage
  - write final `ne.txt` / `ns.txt` once
  - disable block generation
- `server/templates/grid/vector.py`
  - add topology-to-model conversion helper
  - support in-memory vector input path without file reads
  - add timing logs for the fast path

## Verification

1. mount a grid with assembly + vector parameters and confirm:
   - `ne.txt` and `ns.txt` still exist after mount
   - `vector.read_ne` / `vector.read_ns` no longer appear on the fast path
   - `assembly.export_ne_ns_text` no longer appears
2. mount a grid with vector-only parameters and confirm file fallback still works
3. confirm final outputs remain loadable by existing export and downstream APIs

## Non-Goals

- changing API contracts
- changing vector geometry masking logic
- optimizing assembly topology construction itself
- introducing long-lived in-memory resource retention after `MOUNT` returns
