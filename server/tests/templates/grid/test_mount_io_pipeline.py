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
