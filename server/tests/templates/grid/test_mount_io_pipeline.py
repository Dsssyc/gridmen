import sys
import types
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace

SERVER_ROOT = Path(__file__).resolve().parents[3]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

templates_pkg = types.ModuleType("templates")
templates_pkg.__path__ = [str(SERVER_ROOT / "templates")]
sys.modules.setdefault("templates", templates_pkg)

templates_grid_pkg = types.ModuleType("templates.grid")
templates_grid_pkg.__path__ = [str(SERVER_ROOT / "templates" / "grid")]
sys.modules.setdefault("templates.grid", templates_grid_pkg)


def load_grid_hooks_module():
    sys.modules.pop("templates.grid.hooks", None)

    pynoodle_module = types.ModuleType("pynoodle")
    pynoodle_module.noodle = object()
    sys.modules.setdefault("pynoodle", pynoodle_module)

    assembly_module = types.ModuleType("templates.grid.assembly")
    assembly_module.assembly = lambda *args, **kwargs: None
    sys.modules["templates.grid.assembly"] = assembly_module

    crms_pkg = types.ModuleType("crms")
    crms_pkg.__path__ = [str(SERVER_ROOT / "crms")]
    sys.modules.setdefault("crms", crms_pkg)

    crms_grid_module = types.ModuleType("crms.grid")
    crms_grid_module.HydroElements = type("HydroElements", (), {})
    crms_grid_module.HydroSides = type("HydroSides", (), {})
    crms_grid_module.BlockGenerator = type("BlockGenerator", (), {})
    sys.modules["crms.grid"] = crms_grid_module

    return import_module("templates.grid.hooks")


def test_build_model_data_from_topology_preserves_ne_and_ns_layout():
    build_model_data_from_topology = import_module("templates.grid.vector").build_model_data_from_topology
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


def test_mount_fast_path_uses_in_memory_model_data(monkeypatch, tmp_path: Path):
    grid_hooks = load_grid_hooks_module()
    params = {"vector": [{"node_key": ".HK.evaluation.gate", "dem": {"type": "set", "value": 5}}]}
    model_data = {"ne": object(), "ns": object()}
    calls: list[tuple[str, object]] = []

    monkeypatch.setattr(grid_hooks, "get_ne", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("should not read ne.txt")))
    monkeypatch.setattr(grid_hooks, "get_ns", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("should not read ns.txt")))
    monkeypatch.setattr(grid_hooks, "apply_vector_modification", lambda given_params, given_model: calls.append(("apply", given_model)) or given_model)
    monkeypatch.setattr(grid_hooks, "write_ne", lambda _path, ne_data: calls.append(("write_ne", ne_data)))
    monkeypatch.setattr(grid_hooks, "write_ns", lambda _path, ns_data: calls.append(("write_ns", ns_data)))

    result = grid_hooks._handle_vector_modification(params, tmp_path, model_data=model_data)

    assert result is model_data
    assert calls == [("apply", model_data), ("write_ne", model_data["ne"]), ("write_ns", model_data["ns"])]


def test_mount_passes_assembly_model_data_into_vector_stage(monkeypatch, tmp_path: Path):
    grid_hooks = load_grid_hooks_module()
    params = {
        "assembly": {"schema_node_key": ".schema", "patch_node_keys": [".patch"]},
        "vector": [{"node_key": ".HK.evaluation.gate"}],
    }
    assembly_result = SimpleNamespace(model_data={"ne": "NE", "ns": "NS"})
    captured: list[dict[str, object] | Path] = []

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(grid_hooks, "_handle_assembly", lambda *_args, **_kwargs: assembly_result)
    monkeypatch.setattr(
        grid_hooks,
        "_handle_vector_modification",
        lambda _params, _resource_dir, model_data=None: captured.append(model_data),
    )

    grid_hooks.MOUNT(".HK.demo.grid", params)

    assert captured == [assembly_result.model_data]


def test_handle_assembly_builds_model_data_without_export_or_block_generation(monkeypatch, tmp_path: Path):
    grid_hooks = load_grid_hooks_module()
    expected_model_data = {"ne": "NE", "ns": "NS"}
    build_calls: list[tuple[object, object]] = []

    class FakeHydroElements:
        def __init__(self, _path: str):
            self.es = [SimpleNamespace(index=1)]

        def export_ne(self, _path: str):
            raise AssertionError("should not export ne.txt during assembly")

    class FakeHydroSides:
        def __init__(self, _path: str):
            self.ss = [SimpleNamespace(index=1)]

        def export_ns(self, _path: str):
            raise AssertionError("should not export ns.txt during assembly")

    class FailingBlockGenerator:
        def __init__(self, *args, **kwargs):
            raise AssertionError("should not run block generation during assembly")

    monkeypatch.setattr(grid_hooks, "assembly", lambda *_args, **_kwargs: {"epsg": 4326})
    monkeypatch.setattr(grid_hooks, "HydroElements", FakeHydroElements)
    monkeypatch.setattr(grid_hooks, "HydroSides", FakeHydroSides)
    monkeypatch.setattr(grid_hooks, "BlockGenerator", FailingBlockGenerator, raising=False)
    monkeypatch.setattr(
        grid_hooks,
        "build_model_data_from_topology",
        lambda ne_topology, ns_topology: build_calls.append((ne_topology, ns_topology)) or expected_model_data,
        raising=False,
    )

    result = grid_hooks._handle_assembly(
        {"schema_node_key": ".schema", "patch_node_keys": [".patch"]},
        ".HK.demo.grid",
        tmp_path,
    )

    assert result.model_data is expected_model_data
    assert build_calls
    assert (tmp_path / "grid.meta.json").exists()


def test_mount_persists_assembly_model_data_once_when_vector_is_absent(monkeypatch, tmp_path: Path):
    grid_hooks = load_grid_hooks_module()
    params = {"assembly": {"schema_node_key": ".schema", "patch_node_keys": [".patch"]}}
    assembly_result = SimpleNamespace(model_data={"ne": "NE", "ns": "NS"})
    writes: list[tuple[str, str, str]] = []

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(grid_hooks, "_handle_assembly", lambda *_args, **_kwargs: assembly_result)
    monkeypatch.setattr(grid_hooks, "write_ne", lambda path, data: writes.append(("ne", Path(path).name, data)))
    monkeypatch.setattr(grid_hooks, "write_ns", lambda path, data: writes.append(("ns", Path(path).name, data)))

    grid_hooks.MOUNT(".HK.demo.grid", params)

    assert writes == [("ne", "ne.txt", "NE"), ("ns", "ns.txt", "NS")]


def test_handle_vector_modification_file_fallback_reads_existing_text(monkeypatch, tmp_path: Path):
    grid_hooks = load_grid_hooks_module()
    params = {"vector": [{"node_key": ".HK.evaluation.gate"}]}
    ne_data = object()
    ns_data = object()
    calls: list[str] = []

    (tmp_path / "ne.txt").write_text("placeholder", encoding="utf-8")
    (tmp_path / "ns.txt").write_text("placeholder", encoding="utf-8")

    monkeypatch.setattr(grid_hooks, "get_ne", lambda _path: calls.append("get_ne") or ne_data)
    monkeypatch.setattr(grid_hooks, "get_ns", lambda _path: calls.append("get_ns") or ns_data)
    monkeypatch.setattr(grid_hooks, "apply_vector_modification", lambda _params, _model_data: {"ne": ne_data, "ns": ns_data})
    monkeypatch.setattr(grid_hooks, "write_ne", lambda *_args, **_kwargs: calls.append("write_ne"))
    monkeypatch.setattr(grid_hooks, "write_ns", lambda *_args, **_kwargs: calls.append("write_ns"))

    grid_hooks._handle_vector_modification(params, tmp_path)

    assert calls == ["get_ne", "get_ns", "write_ne", "write_ns"]
