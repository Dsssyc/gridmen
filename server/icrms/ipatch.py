import c_two as cc
import pyarrow as pa

# Define transferables ##################################################

class PatchSchema:
    """
    Patch Schema
    ---
    - epsg (int): the EPSG code of the patch
    - bounds (list[float]): the bounds of the patch in the format [min_x, min_y, max_x, max_y]
    - first_size (float): the size of the first patch (unit: m)
    - subdivide_rules (list[tuple[int, int]]): the subdivision rules of the patch in the format [(sub_width, sub_height)]
    - schema_node_key (str): the schema node key
    """
    epsg: int
    bounds: list[float]  # [min_x, min_y, max_x, max_y]
    first_size: list[float] # [width, height]
    grid_info: list[tuple[float, float]]    # [(width_in_meter, height_in_meter), ...], grid size in each level
    subdivide_rules: list[list[int]]  # [(sub_width, sub_height), ...]
    alignment_origin: tuple[float, float] # [lon, lat], base point of the patch
    schema_node_key: str # The schema node key

@cc.transferable
class CellAttribute:
    """
    Attributes of a Cell
    ---
    - level (uint8): the level of the cell
    - type (uint8): the type of the cell, default to 0
    - activate (bool), the subdivision status of the cell
    - deleted (bool): the deletion status of the cell, default to False
    - elevation (float64): the elevation of the cell, default to -9999.0
    - global_id (uint32): the global id within the bounding box that subdivided by cells all in the level of this cell
    - local_id (uint32): the local id within the parent cell that subdivided by child cells all in the level of this cell
    - min_x (float64): the min x coordinate of the cell
    - min_y (float64): the min y coordinate of the cell
    - max_x (float64): the max x coordinate of the cell
    - max_y (float64): the max y coordinate of the cell
    """
    level: int
    type: int
    activate: bool
    global_id: int
    deleted: bool = False   
    elevation: float = -9999.0
    local_id: int | None = None
    min_x: float | None = None
    min_y: float | None = None
    max_x: float | None = None
    max_y: float | None = None
    
    def serialize(data: 'CellAttribute') -> bytes:
        schema = pa.schema([
            pa.field('deleted', pa.bool_()),
            pa.field('activate', pa.bool_()),
            pa.field('type', pa.uint8()),
            pa.field('level', pa.uint8()),
            pa.field('global_id', pa.uint32()),
            pa.field('local_id', pa.uint32(), nullable=True),
            pa.field('elevation', pa.float64()),
            pa.field('min_x', pa.float64(), nullable=True),
            pa.field('min_y', pa.float64(), nullable=True),
            pa.field('max_x', pa.float64(), nullable=True),
            pa.field('max_y', pa.float64(), nullable=True),
        ])
        
        table = pa.Table.from_pylist([data.__dict__], schema=schema)
        return serialize_from_table(table)
    
    def deserialize(arrow_bytes: bytes) -> 'CellAttribute':
        row = deserialize_to_rows(arrow_bytes)[0]
        return CellAttribute(
            deleted=row['deleted'],
            activate=row['activate'],
            type=row['type'],
            level=row['level'],
            global_id=row['global_id'],
            local_id=row['local_id'],
            elevation=row['elevation'],
            min_x=row['min_x'],
            min_y=row['min_y'],
            max_x=row['max_x'],
            max_y=row['max_y']
        )

@cc.transferable
class CellInfo:
    def serialize(level: int, global_id: int) -> bytes:
        schema = pa.schema([
            pa.field('level', pa.uint8()),
            pa.field('global_id', pa.uint32())
        ])
        
        data = {
            'level': level,
            'global_id': global_id
        }
        
        table = pa.Table.from_pylist([data], schema=schema)
        return serialize_from_table(table)

    def deserialize(arrow_bytes: bytes) -> tuple[int, int]:
        row = deserialize_to_rows(arrow_bytes)[0]
        return (
            row['level'],
            row['global_id']
        )

@cc.transferable
class PeerCellInfos:
    def serialize(level: int, global_ids: list[int]) -> bytes:
        schema = pa.schema([
            pa.field('level', pa.uint8()),
            pa.field('global_ids', pa.list_(pa.uint32()))
        ])
        
        data = {
            'level': level,
            'global_ids': global_ids
        }
        
        table = pa.Table.from_pylist([data], schema=schema)
        return serialize_from_table(table)

    def deserialize(bytes: bytes) -> tuple[int, list[int]]:
        row = deserialize_to_rows(bytes)[0]
        return (
            row['level'],
            row['global_ids']
        )

@cc.transferable
class CellInfos:
    def serialize(levels: list[int], global_ids: list[int]) -> bytes:
        schema = pa.schema([
            pa.field('levels', pa.uint8()),
            pa.field('global_ids', pa.uint32())
        ])
        table = pa.Table.from_arrays(
            [
                pa.array(levels, type=pa.uint8()), 
                pa.array(global_ids, type=pa.uint32())
            ],
            schema=schema
        )
        return serialize_from_table(table)

    def deserialize(arrow_bytes: bytes) -> tuple[list[int], list[list[int]]]:
        table = deserialize_to_table(arrow_bytes)
        levels = table.column('levels').to_pylist()
        global_ids = table.column('global_ids').to_pylist()
        return levels, global_ids

@cc.transferable
class CellAttributes:
    def serialize(data: list[CellAttribute]) -> bytes:
        schema = pa.schema([
            pa.field('attribute_bytes', pa.list_(pa.binary())),
        ])

        data_dict = {
            'attribute_bytes': [CellAttribute.serialize(cell) for cell in data]
        }
        
        table = pa.Table.from_pylist([data_dict], schema=schema)
        return serialize_from_table(table)

    def deserialize(arrow_bytes: bytes) -> list[CellAttribute]:
        table = deserialize_to_table(arrow_bytes)
        
        cell_bytes = table.column('attribute_bytes').to_pylist()[0]
        
        return [CellAttribute.deserialize(cell_byte) for cell_byte in cell_bytes]

@cc.transferable
class CellKeys:
    def serialize(keys: list[str | None]) -> bytes:
        schema = pa.schema([pa.field('keys', pa.string())])
        data = {'keys': keys}
        table = pa.Table.from_pydict(data, schema=schema)
        return serialize_from_table(table)

    def deserialize(arrow_bytes: bytes) -> list[str | None]:
        table = deserialize_to_table(arrow_bytes)
        keys = table.column('keys').to_pylist()
        return keys

@cc.transferable
class CellCenter:
    def serialize(lon: float, lat: float) -> bytes:
        schema = pa.schema([
            pa.field('lon', pa.float64()),
            pa.field('lat', pa.float64()),
        ])
        
        data = {
            'lon': lon,
            'lat': lat,
        }
        
        table = pa.Table.from_pylist([data], schema=schema)
        return serialize_from_table(table)

    def deserialize(arrow_bytes: bytes) -> tuple[float, float]:
        row = deserialize_to_rows(arrow_bytes)[0]
        return (
            row['lon'],
            row['lat']
        )

@cc.transferable
class MultiCellCenters:
    def serialize(centers: list[tuple[float, float]]) -> bytes:
        schema = pa.schema([
            pa.field('lon', pa.float64()),
            pa.field('lat', pa.float64()),
        ])
        
        data = {
            'lon': [center[0] for center in centers],
            'lat': [center[1] for center in centers],
        }
        
        table = pa.Table.from_pydict(data, schema=schema)
        return serialize_from_table(table)

    def deserialize(arrow_bytes: bytes) -> list[tuple[float, float]]:
        table = deserialize_to_table(arrow_bytes)
        lon = table.column('lon').to_pylist()
        lat = table.column('lat').to_pylist()
        return list(zip(lon, lat))

@cc.transferable
class FloatArray:
    def serialize(data: list[float]) -> bytes:
        schema = pa.schema([
            pa.field('data', pa.float64())
        ])
        data = {'data': data}
        table = pa.Table.from_pydict(data, schema=schema)
        return serialize_from_table(table)

    def deserialize(arrow_bytes: bytes) -> list[float]:
        table = deserialize_to_table(arrow_bytes)
        data = table.column('data').to_pylist()
        return data

@cc.transferable
class PatchSaveInfo:
    success: bool
    message: str
    
    def serialize(info: 'PatchSaveInfo') -> bytes:
        schema = pa.schema([
            pa.field('success', pa.bool_()),
            pa.field('message', pa.string()),
        ])
        
        table = pa.Table.from_pylist([info.__dict__], schema=schema)
        return serialize_from_table(table)
    
    def deserialize(arrow_bytes: bytes) -> 'PatchSaveInfo':
        row = deserialize_to_rows(arrow_bytes)[0]
        return PatchSaveInfo(
            success=row['success'],
            message=row['message'],
        )

# Define ICRM ###########################################################

@cc.icrm(namespace='gridmen', version='1.0.0')
class IPatch:
    """
    ICRM
    =
    Interface of Core Resource Model (ICRM) specifies how to interact with CRM. 
    """
    def get_meta(self) -> PatchSchema:
        """
        Get the schema of the patch
        
        Returns:
            PatchSchema: Patch schema information
        """
        ...
    
    def get_level_info(self) -> list[dict[str, int]]:
        ...
    
    def subdivide_cells(self, levels: list[int], global_ids: list[int]) -> tuple[list[int], list[int]]:
        ...
        
    def merge_cells(self, levels: list[int], global_ids: list[int]) -> tuple[list[int], list[int]]:
        ...
        
    def delete_cells(self, levels: list[int], global_ids: list[int]):
        ...
        
    def restore_cells(self, levels: list[int], global_ids: list[int]):
        ...
    
    def get_activated_cell_infos(self) -> tuple[list[int], list[int]]:
        ...
    
    def get_deleted_cell_infos(self) -> tuple[list[int], list[int]]:
        ...
    
    def get_cell_bboxes(self, levels: list[int], global_ids: list[int]) -> list[float]:
        ...

    def save(self) -> PatchSaveInfo:
        ...

# Helpers ##################################################

def serialize_from_table(table: pa.Table) -> bytes:
    sink = pa.BufferOutputStream()
    with pa.ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    binary_data = sink.getvalue().to_pybytes()
    return binary_data

def deserialize_to_table(serialized_data: bytes) -> pa.Table:
    buffer = pa.py_buffer(serialized_data)
    with pa.ipc.open_stream(buffer) as reader:
        table = reader.read_all()
    return table

def deserialize_to_rows(serialized_data: bytes) -> dict:
    buffer = pa.py_buffer(serialized_data)

    with pa.ipc.open_stream(buffer) as reader:
        table = reader.read_all()

    return table.to_pylist()