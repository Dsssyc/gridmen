import sys
import types
import struct
import pytest
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
    expected = struct.pack(
        "!QdddddBBBBBQQQQ",
        1,
        10.0,
        20.0,
        30.0,
        40.0,
        5.5,
        7,
        1,
        1,
        1,
        1,
        3,
        5,
        4,
        2,
    )
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
    assert record == expected
    assert len(record) == struct.calcsize("!QdddddBBBBBQQQQ")


def test_generate_cell_record_from_precomputed_geometry_rejects_uint8_overflow():
    edges = [[], [], [], [0] * 256]

    try:
        assembly._generate_cell_record_from_geometry(
            index=0,
            min_xs=10.0,
            min_ys=20.0,
            max_xs=30.0,
            max_ys=40.0,
            edges=edges,
            altitude=5.5,
            lum_type=7,
        )
    except ValueError as exc:
        message = str(exc)
        assert "east_edge_count=256" in message
        assert "Cell record uint8 overflow" in message
        assert "center=(20.00, 30.00)" in message
    else:
        raise AssertionError("Expected ValueError for uint8 overflow")


def test_generate_edge_record_from_precomputed_geometry_matches_existing_shape():
    expected = struct.pack(
        "!QBddddQQdi",
        1,
        1,
        10.0,
        20.0,
        30.0,
        20.0,
        8,
        9,
        9.5,
        3,
    )
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
    assert record == expected
    assert len(record) == struct.calcsize("!QBddddQQdi")


def test_get_edge_coordinates_rejects_unknown_direction():
    edge_data = struct.pack("!BIIIIII", 2, 1, 1, 2, 1, 3, 1)

    with pytest.raises(ValueError, match="Unexpected edge direction=2"):
        assembly._get_edge_coordinates(edge_data, [0.0, 0.0, 1.0, 1.0])


@pytest.mark.parametrize(
    ("worker", "args", "extra_kwargs", "prefix"),
    [
        (
            "_batch_cell_records_worker",
            (b"", [], 0),
            {"meta_level_info": [], "grid_info": []},
            "record.cell.worker",
        ),
        (
            "_batch_edge_records_worker",
            ([], [], 0),
            {},
            "record.edge.worker",
        ),
    ],
)
def test_record_workers_emit_separate_dem_and_lum_timing(monkeypatch, worker, args, extra_kwargs, prefix):
    calls = []

    def fake_timed(label, **extra):
        calls.append(label)

        class _Ctx:
            def __enter__(self):
                return None

            def __exit__(self, exc_type, exc, tb):
                return False

        return _Ctx()

    monkeypatch.setattr(assembly, "timed", fake_timed)
    monkeypatch.setattr(assembly, "_get_raster_value", lambda *args, **kwargs: None)

    getattr(assembly, worker)(args, [0.0, 0.0, 1.0, 1.0], dem_path=None, lum_path=None, **extra_kwargs)

    assert f"{prefix}.pack" in calls
    assert f"{prefix}.dem_sample" in calls
    assert f"{prefix}.lum_sample" in calls
