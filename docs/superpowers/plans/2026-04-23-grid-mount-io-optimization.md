# Grid Mount IO Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant NE/NS export-readback cycle inside one grid `MOUNT`, while still persisting final `ne.txt` and `ns.txt` exactly once.

**Architecture:** `assembly()` still produces the binary topology files, but `hooks.py` now keeps the loaded `HydroElements` / `HydroSides` in memory, converts them directly into the existing `NeData` / `NsData` model shape, and passes that model into the vector stage. The vector logic keeps its current numpy-based behavior; only the data source changes from text-file parse to an in-memory handoff, with the old file path preserved as a vector-only fallback.

**Tech Stack:** Python 3.12+, pytest, uv, FastAPI hook modules, numpy, existing grid topology classes in `server/crms/grid.py`.

---

## File Structure

| File | Role |
|---|---|
| `server/templates/grid/vector.py` | Add topology→model conversion helper and keep vector logic operating on `NeData` / `NsData` |
| `server/templates/grid/hooks.py` | Introduce mount-local assembly result, thread in-memory model data through mount, persist final text outputs once, disable block generation |
| `server/tests/templates/grid/test_mount_io_pipeline.py` | New targeted tests for topology conversion and mount fast-path / fallback orchestration |
| `docs/superpowers/specs/2026-04-23-mount-io-optimization-design.md` | Approved design reference for the implementation |

---

### Task 1: Build `NeData` / `NsData` directly from topology

**Files:**
- Modify: `server/templates/grid/vector.py:27-118`
- Test: `server/tests/templates/grid/test_mount_io_pipeline.py`

- [ ] **Step 1: Write the failing test**

```python
from types import SimpleNamespace

from templates.grid.vector import build_model_data_from_topology


def test_build_model_data_from_topology_preserves_ne_and_ns_layout():
    ne_topology = SimpleNamespace(
        es=[
            SimpleNamespace(
                index=1,
                left_edges=[11, 12],
                right_edges=[13],
                bottom_edges=[14],
                top_edges=[15, 16],
                center=(100.5, 200.5, 3.25),
                type=7,
            )
        ]
    )
    ns_topology = SimpleNamespace(
        ss=[
            SimpleNamespace(
                index=21,
                ns=[21, 2, 101, 102, 0, 0, 8.5, 300.0, 400.0, 5.5, 9],
            )
        ]
    )

    model_data = build_model_data_from_topology(ne_topology, ns_topology)

    ne = model_data["ne"]
    ns = model_data["ns"]
    assert ne.grid_id_list == [0, 1]
    assert ne.nsl1_list == [0, 2]
    assert ne.isl1_list[1][:3] == [0, 11, 12]
    assert ne.xe_list == [0.0, 100.5]
    assert ne.ye_list == [0.0, 200.5]
    assert ne.ze_list == [0.0, 3.25]
    assert ne.under_suf_list == [0, 7]
    assert ns.edge_id_list == [0, 21]
    assert ns.ise_list == [[0, 0, 0, 0, 0], [2, 101, 102, 0, 0]]
    assert ns.dis_list == [0.0, 8.5]
    assert ns.x_side_list == [0.0, 300.0]
    assert ns.y_side_list == [0.0, 400.0]
    assert ns.z_side_list == [0.0, 5.5]
    assert ns.s_type_list == [0, 9]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && uv run pytest tests/templates/grid/test_mount_io_pipeline.py::test_build_model_data_from_topology_preserves_ne_and_ns_layout -v`
Expected: FAIL with `ImportError` or `AttributeError` because `build_model_data_from_topology` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```python
def build_model_data_from_topology(ne_topology: Any, ns_topology: Any) -> dict[str, NeData | NsData]:
    ne_data = NeData([0], [0], [0], [0], [0], [[0] * 10], [[0] * 10], [[0] * 10], [[0] * 10], [0.0], [0.0], [0.0], [0])
    for element in ne_topology.es:
        ne_data.grid_id_list.append(int(element.index))
        ne_data.nsl1_list.append(len(element.left_edges))
        ne_data.nsl2_list.append(len(element.right_edges))
        ne_data.nsl3_list.append(len(element.bottom_edges))
        ne_data.nsl4_list.append(len(element.top_edges))
        ne_data.isl1_list.append([0, *map(int, element.left_edges), *([0] * max(0, 9 - len(element.left_edges)))][: max(10, len(element.left_edges) + 1)])
        ne_data.isl2_list.append([0, *map(int, element.right_edges), *([0] * max(0, 9 - len(element.right_edges)))][: max(10, len(element.right_edges) + 1)])
        ne_data.isl3_list.append([0, *map(int, element.bottom_edges), *([0] * max(0, 9 - len(element.bottom_edges)))][: max(10, len(element.bottom_edges) + 1)])
        ne_data.isl4_list.append([0, *map(int, element.top_edges), *([0] * max(0, 9 - len(element.top_edges)))][: max(10, len(element.top_edges) + 1)])
        x, y, z = element.center
        ne_data.xe_list.append(float(x))
        ne_data.ye_list.append(float(y))
        ne_data.ze_list.append(float(z))
        ne_data.under_suf_list.append(int(element.type))

    ns_data = NsData([0], [[0, 0, 0, 0, 0]], [0.0], [0.0], [0.0], [0.0], [0])
    for side in ns_topology.ss:
        edge_id, direction, left_idx, right_idx, bottom_idx, top_idx, distance, x, y, z, side_type = side.ns
        ns_data.edge_id_list.append(int(edge_id))
        ns_data.ise_list.append([int(direction), int(left_idx), int(right_idx), int(bottom_idx), int(top_idx)])
        ns_data.dis_list.append(float(distance))
        ns_data.x_side_list.append(float(x))
        ns_data.y_side_list.append(float(y))
        ns_data.z_side_list.append(float(z))
        ns_data.s_type_list.append(int(side_type))

    return {"ne": ne_data, "ns": ns_data}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && uv run pytest tests/templates/grid/test_mount_io_pipeline.py::test_build_model_data_from_topology_preserves_ne_and_ns_layout -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/templates/grid/vector.py server/tests/templates/grid/test_mount_io_pipeline.py
git commit -m "test(vector): build mount model data from topology"
```

### Task 2: Return mount-local assembly state and remove intermediate text export

**Files:**
- Modify: `server/templates/grid/hooks.py:18-130`
- Modify: `server/templates/grid/vector.py:1298-1440`
- Test: `server/tests/templates/grid/test_mount_io_pipeline.py`

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path
from types import SimpleNamespace

from templates.grid import hooks as grid_hooks


def test_mount_fast_path_uses_in_memory_model_data(monkeypatch, tmp_path: Path):
    params = {"vector": [{"node_key": ".HK.evaluation.gate", "dem": {"type": "set", "value": 5}}]}
    model_data = {"ne": object(), "ns": object()}
    calls: list[tuple[str, object]] = []

    monkeypatch.setattr(grid_hooks, "get_ne", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("should not read ne.txt")))
    monkeypatch.setattr(grid_hooks, "get_ns", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("should not read ns.txt")))
    monkeypatch.setattr(grid_hooks, "apply_vector_modification", lambda given_params, given_model: calls.append(("apply", given_model)) or given_model)
    monkeypatch.setattr(grid_hooks, "write_ne", lambda path, ne_data: calls.append(("write_ne", ne_data)))
    monkeypatch.setattr(grid_hooks, "write_ns", lambda path, ns_data: calls.append(("write_ns", ns_data)))

    result = grid_hooks._handle_vector_modification(params, tmp_path, model_data=model_data)

    assert result is model_data
    assert calls == [("apply", model_data), ("write_ne", model_data["ne"]), ("write_ns", model_data["ns"])]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && uv run pytest tests/templates/grid/test_mount_io_pipeline.py::test_mount_fast_path_uses_in_memory_model_data -v`
Expected: FAIL because `_handle_vector_modification()` does not accept `model_data` yet.

- [ ] **Step 3: Write minimal implementation**

```python
@dataclass
class MountAssemblyResult:
    ne_topology: HydroElements
    ns_topology: HydroSides
    model_data: dict[str, NeData | NsData]


def _handle_assembly(...) -> MountAssemblyResult:
    meta_info = assembly(...)
    ne_topology = HydroElements(str(resource_dir / "cell_topo.bin"))
    ns_topology = HydroSides(str(resource_dir / "edge_topo.bin"))
    with timed("mount.build_model_data_from_topology"):
        model_data = build_model_data_from_topology(ne_topology, ns_topology)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta_info, f, indent=4)
    return MountAssemblyResult(ne_topology=ne_topology, ns_topology=ns_topology, model_data=model_data)


def _handle_vector_modification(params: dict, resource_dir: Path, model_data: dict[str, NeData | NsData] | None = None):
    model_source = "in_memory" if model_data is not None else "file"
    if model_data is None:
        with timed("vector.read_ne", path=str(ne_path)):
            ne_data = get_ne(ne_path)
        with timed("vector.read_ns", path=str(ns_path)):
            ns_data = get_ns(ns_path)
        model_data = {"ne": ne_data, "ns": ns_data}
    timing_logger.debug("mount.vector_input source=%s", model_source)
    modified_model_data = apply_vector_modification(params, model_data)
    with timed("mount.persist_ne_ns_once", path=str(resource_dir)):
        write_ne(ne_path, modified_model_data["ne"])
        write_ns(ns_path, modified_model_data["ns"])
    return modified_model_data
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && uv run pytest tests/templates/grid/test_mount_io_pipeline.py::test_build_model_data_from_topology_preserves_ne_and_ns_layout tests/templates/grid/test_mount_io_pipeline.py::test_mount_fast_path_uses_in_memory_model_data -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/templates/grid/hooks.py server/templates/grid/vector.py server/tests/templates/grid/test_mount_io_pipeline.py
git commit -m "feat(grid): hand off mount model data in memory"
```

### Task 3: Preserve vector-only fallback and remove block generation from the critical path

**Files:**
- Modify: `server/templates/grid/hooks.py:55-130`
- Test: `server/tests/templates/grid/test_mount_io_pipeline.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_handle_vector_modification_file_fallback_reads_existing_text(monkeypatch, tmp_path: Path):
    params = {"vector": [{"node_key": ".HK.evaluation.gate"}]}
    ne_data = object()
    ns_data = object()
    calls: list[str] = []

    (tmp_path / "ne.txt").write_text("placeholder", encoding="utf-8")
    (tmp_path / "ns.txt").write_text("placeholder", encoding="utf-8")

    monkeypatch.setattr(grid_hooks, "get_ne", lambda path: calls.append("get_ne") or ne_data)
    monkeypatch.setattr(grid_hooks, "get_ns", lambda path: calls.append("get_ns") or ns_data)
    monkeypatch.setattr(grid_hooks, "apply_vector_modification", lambda given_params, given_model: {"ne": ne_data, "ns": ns_data})
    monkeypatch.setattr(grid_hooks, "write_ne", lambda *_args, **_kwargs: calls.append("write_ne"))
    monkeypatch.setattr(grid_hooks, "write_ns", lambda *_args, **_kwargs: calls.append("write_ns"))

    grid_hooks._handle_vector_modification(params, tmp_path)

    assert calls == ["get_ne", "get_ns", "write_ne", "write_ns"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && uv run pytest tests/templates/grid/test_mount_io_pipeline.py::test_handle_vector_modification_file_fallback_reads_existing_text -v`
Expected: FAIL until the final persistence and fallback branching are both wired correctly.

- [ ] **Step 3: Write minimal implementation**

```python
def MOUNT(node_key: str, params: dict | None = None):
    assembly_result = None
    if "assembly" in params:
        assembly_result = _handle_assembly(assembly_params, node_key, resource_dir)
    if "vector" in params and params["vector"]:
        model_data = assembly_result.model_data if assembly_result is not None else None
        _handle_vector_modification(params, resource_dir, model_data=model_data)
    elif assembly_result is not None:
        with timed("mount.persist_ne_ns_once", path=str(resource_dir)):
            write_ne(resource_dir / "ne.txt", assembly_result.model_data["ne"])
            write_ns(resource_dir / "ns.txt", assembly_result.model_data["ns"])

    # Block generation stays disabled until visualization starts using it again.
    # if False:
    #     generator = BlockGenerator(output_dir=str(resource_dir / "blocks"), base_name=node_key)
    #     generator.process(assembly_result.ne_topology.es)
```

- [ ] **Step 4: Run the focused test file**

Run: `cd server && uv run pytest tests/templates/grid/test_mount_io_pipeline.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/templates/grid/hooks.py server/tests/templates/grid/test_mount_io_pipeline.py
git commit -m "refactor(grid): persist ne ns once per mount"
```

### Task 4: Verify the mount benchmark path

**Files:**
- Modify: none
- Test: `server/tests/templates/grid/test_mount_io_pipeline.py`

- [ ] **Step 1: Run the focused backend tests**

Run: `cd server && uv run pytest tests/templates/grid/test_mount_io_pipeline.py -v`
Expected: PASS

- [ ] **Step 2: Run the existing backend test suite to catch regressions**

Run: `cd server && uv run pytest py-noodle/tests/ -v`
Expected: PASS

- [ ] **Step 3: Run a mount benchmark smoke check**

Run: `cd server && uv run main.py`
Expected: server starts cleanly; after triggering the same mount flow from the app, logs show `mount.build_model_data_from_topology`, `mount.persist_ne_ns_once`, no `assembly.export_ne_ns_text`, and no `vector.read_ne` / `vector.read_ns` on the assembly+vector path.

- [ ] **Step 4: Confirm the working tree is clean**

```bash
git status --short
```

Expected: clean working tree

---

## Self-Review

- **Spec coverage:** Task 1 covers topology→model conversion. Tasks 2 and 3 cover in-memory handoff, final single-write persistence, file fallback, and block-generation removal. Task 4 covers verification and benchmark-log confirmation.
- **Placeholder scan:** No `TODO` / `TBD` placeholders remain; every task has explicit files, code, commands, and expected results.
- **Type consistency:** The plan consistently uses `build_model_data_from_topology`, `MountAssemblyResult`, and `_handle_vector_modification(..., model_data=...)` across all tasks.
