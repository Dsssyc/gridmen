# Assembly Recording Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce assembly topology recording overhead and expose DEM/LUM sampling cost with fine-grained timing.

**Architecture:** Keep the current batch-based multiprocessing pipeline, but instrument the recording stages so cell and edge work are split into build-batch, worker, raster-open, DEM sample, LUM sample, pack, and parent-write phases. Then remove repeated decode / coordinate work in the worker hot path and tighten cell record packing without changing the binary output format.

**Tech Stack:** Python 3.12+, pytest, multiprocessing, rasterio, struct, existing `timed()` logging in `server/templates/grid/_timing.py`.

---

## File Structure

| File | Role |
|---|---|
| `server/templates/grid/assembly.py` | Add new timing phases and low-risk record-builder refactors |
| `server/tests/templates/grid/test_recording_optimization.py` | New focused tests for cell/edge record helpers and stage orchestration |
| `docs/superpowers/specs/2026-04-23-assembly-recording-optimization-design.md` | Approved design reference |

---

### Task 1: Lock in the new recording API with failing tests

**Files:**
- Create: `server/tests/templates/grid/test_recording_optimization.py`
- Modify: `server/templates/grid/assembly.py:766-1088`

- [ ] **Step 1: Write the failing tests**

```python
import sys
import types
from importlib import import_module
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[3]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

templates_pkg = types.ModuleType("templates")
templates_pkg.__path__ = [str(SERVER_ROOT / "templates")]
sys.modules.setdefault("templates", templates_pkg)

templates_grid_pkg = types.ModuleType("templates.grid")
templates_grid_pkg.__path__ = [str(SERVER_ROOT / "templates" / "grid")]
sys.modules.setdefault("templates.grid", templates_grid_pkg)

assembly = import_module("templates.grid.assembly")


def test_generate_cell_record_from_precomputed_geometry_matches_existing_shape():
    edges = [[1], [2], [3], [4]]
    record = assembly._generate_cell_record_from_geometry(
        index=0,
        min_xs=10.0,
        min_ys=20.0,
        max_xs=30.0,
        max_ys=40.0,
        edges=edges,
        altitude=5.5,
        lum_type=7,
    )
    assert isinstance(record, (bytes, bytearray))
    assert len(record) > 0


def test_generate_edge_record_from_precomputed_geometry_matches_existing_shape():
    record = assembly._generate_edge_record_from_geometry(
        index=0,
        direction=1,
        x_min=10.0,
        y_min=20.0,
        x_max=30.0,
        y_max=20.0,
        edge_grids=[7, 8],
        altitude=9.5,
        lum_type=3,
    )
    assert isinstance(record, (bytes, bytearray))
    assert len(record) == 74
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && uv run pytest tests/templates/grid/test_recording_optimization.py -v`
Expected: FAIL with `AttributeError` because the new precomputed-geometry helpers do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```python
def _generate_cell_record_from_geometry(index, min_xs, min_ys, max_xs, max_ys, edges, altitude=-9999.0, lum_type=0) -> bytes:
    west = [edge_index + 1 for edge_index in edges[EdgeCode.WEST]]
    east = [edge_index + 1 for edge_index in edges[EdgeCode.EAST]]
    south = [edge_index + 1 for edge_index in edges[EdgeCode.SOUTH]]
    north = [edge_index + 1 for edge_index in edges[EdgeCode.NORTH]]
    fmt = "!" + "QdddddBBBB" + ("Q" * (len(west) + len(east) + len(south) + len(north)))
    return struct.pack(
        fmt,
        index + 1,
        min_xs,
        min_ys,
        max_xs,
        max_ys,
        altitude,
        lum_type,
        len(west),
        len(east),
        len(south),
        len(north),
        *west,
        *east,
        *south,
        *north,
    )


def _generate_edge_record_from_geometry(index, direction, x_min, y_min, x_max, y_max, edge_grids, altitude=-9999.0, lum_type=0) -> bytes:
    return struct.pack("!QBddddQQdi", index + 1, direction, x_min, y_min, x_max, y_max, edge_grids[0] + 1 if edge_grids[0] is not None else 0, edge_grids[1] + 1 if edge_grids[1] is not None else 0, altitude, lum_type)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && uv run pytest tests/templates/grid/test_recording_optimization.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/templates/grid/assembly.py server/tests/templates/grid/test_recording_optimization.py
git commit -m "test(assembly): lock recording helper API"
```

### Task 2: Add fine-grained timing and remove duplicate cell/edge work

**Files:**
- Modify: `server/templates/grid/assembly.py:766-1088`
- Test: `server/tests/templates/grid/test_recording_optimization.py`

- [ ] **Step 1: Write the failing timing test**

```python
def test_record_workers_emit_separate_dem_and_lum_timing(monkeypatch, caplog):
    calls = []

    def fake_timed(label, **extra):
        calls.append(label)
        class _Ctx:
            def __enter__(self): return None
            def __exit__(self, exc_type, exc, tb): return False
        return _Ctx()

    monkeypatch.setattr(assembly, "timed", fake_timed)
    monkeypatch.setattr(assembly, "_get_raster_value", lambda *args, **kwargs: None)

    assembly._batch_edge_records_worker(([], [], 0), [0.0, 0.0, 1.0, 1.0], dem_path=None, lum_path=None)

    assert "record.edge.worker.pack" in calls
    assert "record.edge.worker.dem_sample" in calls
    assert "record.edge.worker.lum_sample" in calls
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && uv run pytest tests/templates/grid/test_recording_optimization.py::test_record_workers_emit_separate_dem_and_lum_timing -v`
Expected: FAIL because the worker currently emits no such sub-phase timings.

- [ ] **Step 3: Write minimal implementation**

```python
with timed("record.edge.build_batch_args", n_batches=len(batch_args)):
    batch_args = [(*_slice_edge_info(i, batch_size, edge_index_cache, edge_adj_cell_indices), i) for i in range(0, len(edge_index_cache), batch_size)]

with timed("record.edge.pool_total", n_batches=len(batch_args), dem=bool(dem_path), lum=bool(lum_path)):
    with mp.Pool(processes=num_processes) as pool, open(edge_record_path, "wb") as f:
        for edge_records_chunk in pool.imap(batch_func, batch_args):
            with timed("record.edge.parent_write", chunk_bytes=len(edge_records_chunk)):
                f.write(edge_records_chunk)
```

Inside both workers:

```python
with timed("record.cell.worker_total", count=cell_count, dem=bool(dem_src), lum=bool(lum_src)):
    with timed("record.cell.worker.dem_sample", count=cell_count):
        ...
    with timed("record.cell.worker.lum_sample", count=cell_count):
        ...
    with timed("record.cell.worker.pack", count=cell_count):
        ...
```

Also replace duplicate unpack / coordinate computation by computing geometry once per record and calling the new `_generate_*_record_from_geometry(...)` helpers.

- [ ] **Step 4: Run focused tests**

Run: `cd server && uv run pytest tests/templates/grid/test_recording_optimization.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/templates/grid/assembly.py server/tests/templates/grid/test_recording_optimization.py
git commit -m "feat(assembly): instrument recording sub-phases"
```

### Task 3: Benchmark and verify the new visibility

**Files:**
- Modify: none
- Test: `server/tests/templates/grid/test_recording_optimization.py`

- [ ] **Step 1: Run focused tests**

Run: `cd server && uv run pytest tests/templates/grid/test_recording_optimization.py -v`
Expected: PASS

- [ ] **Step 2: Run existing mount IO regression tests**

Run: `cd server && uv run pytest tests/templates/grid/test_mount_io_pipeline.py -v`
Expected: PASS

- [ ] **Step 3: Run a benchmark smoke check**

Run: `cd server && uv run main.py`
Expected: after triggering the same mount flow, logs include `record.cell.*` / `record.edge.*` timings plus separate `dem_sample` and `lum_sample` phases, allowing direct attribution of sampling cost.

- [ ] **Step 4: Check working tree**

Run: `cd /Users/soku/Desktop/codespace/WorldInProgress/gridmen && git status --short`
Expected: clean working tree

---

## Self-Review

- **Spec coverage:** Task 1 defines the helper API. Task 2 covers fine-grained timing, duplicate-work removal, and DEM/LUM visibility. Task 3 covers regression and benchmark verification.
- **Placeholder scan:** No `TODO` / `TBD` placeholders remain; every task includes files, commands, and code snippets.
- **Type consistency:** The plan consistently uses `_generate_cell_record_from_geometry`, `_generate_edge_record_from_geometry`, and `record.cell.*` / `record.edge.*` timing labels across tasks.
