import sys
import types
import struct
import numpy as np
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


def test_batch_cell_records_worker_adds_level_and_global_id_to_overflow_errors(monkeypatch):
    def fake_generate_cell_record_from_geometry(**kwargs):
        raise ValueError("Cell record uint8 overflow: east_edge_count=256 (valid: 0-255). cell index=1, center=(2.50, 1.50)")

    monkeypatch.setattr(assembly, "_generate_cell_record_from_geometry", fake_generate_cell_record_from_geometry)

    cell_data = struct.pack(">BQ", 1, 2)
    cell_edges = [[[], [], [], []]]

    with pytest.raises(ValueError, match=r"level=1, global_id=2"):
        assembly._batch_cell_records_worker(
            (cell_data, cell_edges, 0),
            [0.0, 0.0, 10.0, 10.0],
            meta_level_info=[{}, {"width": 2}],
            grid_info=[[1.0, 1.0]],
            dem_path=None,
            lum_path=None,
        )


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


def test_batch_edge_records_worker_clamps_out_of_range_lum_type(monkeypatch):
    class FakeRaster:
        dtypes = ["uint16"]
        nodata = None

        def close(self):
            return None

    monkeypatch.setattr(assembly.os.path, "exists", lambda path: True)
    monkeypatch.setattr(assembly.rasterio, "open", lambda path: FakeRaster())
    monkeypatch.setattr(assembly, "_sample_raster_values", lambda *args, **kwargs: [300.0])

    edge_data = struct.pack("!BIIIIII", 1, 1, 1, 2, 1, 3, 1)
    chunk, _stats = assembly._batch_edge_records_worker(
        ([edge_data], [[7, 8]], 0),
        [0.0, 0.0, 10.0, 10.0],
        dem_path=None,
        lum_path="fake-lum.tif",
    )

    record_len = struct.unpack("!I", chunk[:4])[0]
    record = chunk[4 : 4 + record_len]
    unpacked = struct.unpack("!QBddddQQdi", record)

    assert unpacked[-1] == 0


def test_sample_raster_values_uses_single_batch_transform(monkeypatch):
    transform_calls = []

    class FakeTransformer:
        def transform(self, xs, ys):
            transform_calls.append((tuple(xs), tuple(ys)))
            return xs, ys

    class FakeRaster:
        crs = "FAKE_DST"
        bounds = types.SimpleNamespace(left=0.0, bottom=0.0, right=2.0, top=2.0)
        transform = assembly.rasterio.transform.from_origin(0.0, 2.0, 1.0, 1.0)
        block_shapes = [(2, 2)]
        nodata = None
        dtypes = ["float32"]

        def read(self, band_index, window):
            return np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float32)

    monkeypatch.setattr(
        assembly.Transformer,
        "from_crs",
        lambda *args, **kwargs: FakeTransformer(),
    )

    values = assembly._sample_raster_values(
        FakeRaster(),
        [(0.5, 1.5), (1.5, 0.5)],
        src_crs="EPSG:2326",
    )

    assert values == [1.0, 4.0]
    assert len(transform_calls) == 1
    assert not hasattr(assembly, "transform")


def test_sample_raster_values_reads_each_block_once(monkeypatch):
    read_windows = []

    class FakeTransformer:
        def transform(self, xs, ys):
            return xs, ys

    class FakeRaster:
        crs = "EPSG:2326"
        bounds = types.SimpleNamespace(left=0.0, bottom=0.0, right=4.0, top=4.0)
        transform = assembly.rasterio.transform.from_origin(0.0, 4.0, 1.0, 1.0)
        block_shapes = [(2, 2)]
        nodata = None
        dtypes = ["int16"]

        def read(self, band_index, window):
            read_windows.append((window.col_off, window.row_off, window.width, window.height))
            if (window.col_off, window.row_off) == (0, 0):
                return np.array([[10, 11], [12, 13]], dtype=np.int16)
            raise AssertionError(f"Unexpected window: {window}")

    monkeypatch.setattr(
        assembly.Transformer,
        "from_crs",
        lambda *args, **kwargs: FakeTransformer(),
    )

    values = assembly._sample_raster_values(
        FakeRaster(),
        [(0.5, 3.5), (1.5, 2.5)],
        src_crs="EPSG:2326",
    )

    assert values == [10.0, 13.0]
    assert read_windows == [(0, 0, 2, 2)]


def test_batch_edge_records_worker_uses_batch_sampler(monkeypatch):
    sample_calls = []

    class FakeRaster:
        dtypes = ["uint8"]
        nodata = None

        def close(self):
            return None

    def fake_sample_raster_values(src, points, src_crs):
        sample_calls.append((src, tuple(points), src_crs))
        return [300.0]

    monkeypatch.setattr(assembly.os.path, "exists", lambda path: True)
    monkeypatch.setattr(assembly.rasterio, "open", lambda path: FakeRaster())
    monkeypatch.setattr(assembly, "_sample_raster_values", fake_sample_raster_values)

    edge_data = struct.pack("!BIIIIII", 1, 1, 1, 2, 1, 3, 1)
    chunk, stats = assembly._batch_edge_records_worker(
        ([edge_data], [[7, 8]], 0),
        [0.0, 0.0, 10.0, 10.0],
        dem_path="fake-dem.tif",
        lum_path="fake-lum.tif",
        src_crs="EPSG:2326",
    )

    record_len = struct.unpack("!I", chunk[:4])[0]
    record = chunk[4 : 4 + record_len]
    unpacked = struct.unpack("!QBddddQQdi", record)

    assert len(sample_calls) == 2
    assert unpacked[-2] == 300.0
    assert unpacked[-1] == 0
    assert set(stats) == {"dem_sample", "lum_sample", "pack"}
    assert all(value >= 0.0 for value in stats.values())

def test_record_cell_topology_logs_single_aggregated_sampling_summary(monkeypatch, tmp_path):
    calls = []
    debug_logs = []

    def fake_timed(label, **extra):
        calls.append(label)

        class _Ctx:
            def __enter__(self):
                return None

            def __exit__(self, exc_type, exc, tb):
                return False

        return _Ctx()

    class FakeGridCache:
        def __len__(self):
            return 10001

        def slice_cells(self, start, batch_size):
            return b""

        def slice_edges(self, start, batch_size):
            return []

    class FakePool:
        def __init__(self, processes):
            self.processes = processes

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def imap(self, batch_func, batch_args):
            for _ in batch_args:
                yield b"", {"dem_sample": 1.25, "lum_sample": 2.5, "pack": 0.75}

    monkeypatch.setattr(assembly, "timed", fake_timed)
    monkeypatch.setattr(assembly, "log_debug", lambda msg, *args: debug_logs.append(msg % args if args else msg))
    monkeypatch.setattr(assembly.mp, "Pool", FakePool)

    assembly._record_cell_topology(
        FakeGridCache(),
        [0.0, 0.0, 1.0, 1.0],
        [],
        [],
        str(tmp_path / "grid.bin"),
        dem_path="fake-dem.tif",
        lum_path="fake-lum.tif",
    )

    assert "record.cell.pool_total" in calls
    assert "record.cell.build_batch_args" not in calls
    assert "record.cell.parent_write" not in calls
    assert any(
        "record.cell.phase_totals" in entry
        and "dem_sample=2.5000s" in entry
        and "lum_sample=5.0000s" in entry
        and "pack=1.5000s" in entry
        for entry in debug_logs
    )
