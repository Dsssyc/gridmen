import os
import math
import json
import logging
import numpy as np
import pandas as pd
import pyarrow as pa
from pathlib import Path
import pyarrow.parquet as pq
from collections import Counter
from icrms.ipatch import PatchSchema, PatchSaveInfo

logger = logging.getLogger(__name__)

# Const ##############################

ATTR_DELETED = 'deleted'
ATTR_ACTIVATE = 'activate'
ATTR_INDEX_KEY = 'index_key'

PATCH_SCHEMA: pa.Schema = pa.schema([
    (ATTR_DELETED, pa.bool_()),
    (ATTR_ACTIVATE, pa.bool_()), 
    (ATTR_INDEX_KEY, pa.uint64())
])

class Patch:
    def __init__(self, resource_space: str):
        # Check resource space validity
        self.resource_space = Path(resource_space)
        self.meta_file = self.resource_space / 'patch.meta.json'
        if not self.resource_space.exists():
            raise FileNotFoundError(f'Patch resource directory not found: {resource_space}')
        if not self.meta_file.exists():
            raise FileNotFoundError(f'Patch meta file not found at {self.meta_file}. Resource might be corrupted or not initialized properly.')

        # Get info from patch meta file
        try:
            with open(self.meta_file, 'r') as f:
                meta = json.load(f)
            bounds: list[float] = meta['bounds']
            schema_node_key: str = meta['schema_node_key']
            # Read schema info from nested 'schema' object
            schema_data = meta.get('schema')
            if not schema_data:
                raise KeyError('Missing "schema" object in patch meta')
            
            epsg: int = schema_data['epsg']
            grid_info: list[list[float]] = schema_data['grid_info']
            first_size: list[float] = grid_info[0]
            alignment_origin: list[float] = schema_data['alignment_origin']
        except (KeyError, IndexError) as e:
            raise ValueError(f'Failed to decode patch meta file: {e}')

        # Calculate subdivide rules
        subdivide_rules: list[list[int]] = [
            [
                int(math.ceil((bounds[2] - bounds[0]) / first_size[0])),
                int(math.ceil((bounds[3] - bounds[1]) / first_size[1])),
            ]
        ]
        for i in range(len(grid_info) - 1):
            level_a = grid_info[i]
            level_b = grid_info[i + 1]
            subdivide_rules.append(
                [
                    int(level_a[0] / level_b[0]),
                    int(level_a[1] / level_b[1]),
                ]
            )
        subdivide_rules.append([1, 1])
        
        # Initialize attributes
        self.epsg: int = epsg
        self.grid_info = grid_info
        self.bounds: list = bounds
        self.first_size: list[float] = first_size
        self.schema_node_key: str = schema_node_key
        self.alignment_origin: list[float] = alignment_origin
        self.subdivide_rules: list[list[int]] = subdivide_rules
        self._pd_cache = pd.DataFrame(columns=[ATTR_DELETED, ATTR_ACTIVATE, ATTR_INDEX_KEY])
        
        self._file_path = Path(resource_space) / 'patch.topo.parquet'
        
        # Calculate level info for later use
        self.level_info: list[dict[str, int]] = [{'width': 1, 'height': 1}]
        for level, rule in enumerate(subdivide_rules[:-1]):
            prev_width, prev_height = self.level_info[level]['width'], self.level_info[level]['height']
            self.level_info.append({
                'width': prev_width * rule[0],
                'height': prev_height * rule[1]
            })

    def _load_from_file(self):
        try:
            if self._file_path and os.path.exists(self._file_path):
                patch_table = pq.read_table(self._file_path)
                patch_df = patch_table.to_pandas()
                patch_df.set_index(ATTR_INDEX_KEY, inplace=True)
                self.cache = patch_df.sort_index()
                logger.info(f'Successfully loaded {len(self.cache)} patch records from {self._file_path}')
            else:
                logger.warning(f"Patch file {self._file_path} not found.")
            
        except Exception as e:
            logger.error(f'Error loading patch data from file: {str(e)}')
            raise e

    def _initialize_default(self):
        """Initialize patch data (ONLY Level 1) as pandas DataFrame"""
        level = 1
        total_width = self.level_info[level]['width']
        total_height = self.level_info[level]['height']
        num_cells = total_width * total_height
        
        levels = np.full(num_cells, level, dtype=np.uint8)
        global_ids = np.arange(num_cells, dtype=np.uint32)
        encoded_indices = _encode_index_batch(levels, global_ids)
        
        grid_data = {
            ATTR_ACTIVATE: np.full(num_cells, True),
            ATTR_DELETED: np.full(num_cells, False, dtype=np.bool_),
            ATTR_INDEX_KEY: encoded_indices
        }

        df = pd.DataFrame(grid_data)
        df.set_index([ATTR_INDEX_KEY], inplace=True)

        self._pd_cache = df
        print(f'Successfully initialized patch data with {num_cells} cells at level 1')
   
    def _load_patch(self):
        # Load from Parquet file if file exists
        if self._file_path.exists():
            try:
                # Load patch data from Parquet file
                self._load_from_file()
            except Exception as e:
                logger.error(f'Failed to load patch data from file: {str(e)}, the patch will be initialized using default method')
                self._initialize_default()
        else:
            # Initialize patch data using default method
            logger.info('Patch file does not exist, initializing default patch data...')
            self._initialize_default()
            logger.info('Successfully initialized default patch data')
        logger.info('Patch initialized successfully')
    
    @property
    def cache(self) -> pd.DataFrame:
        if self._pd_cache.empty:
            self._load_patch()
        return self._pd_cache
    
    @cache.setter
    def cache(self, value: pd.DataFrame):
        self._pd_cache = value

    def get_meta(self) -> PatchSchema:
        schema = PatchSchema()
        schema.epsg = self.epsg
        schema.bounds = tuple(self.bounds)
        schema.first_size = tuple(self.first_size)
        schema.subdivide_rules = self.subdivide_rules
        schema.schema_node_key = self.schema_node_key
        schema.alignment_origin = tuple(self.alignment_origin)
        schema.grid_info = [tuple(size) for size in self.grid_info]
        return schema
    
    def get_level_info(self) -> list[dict[str, int]]:
        return self.level_info

    def _save(self) -> dict[str, str | bool]:
        patch_save_success = True
        patch_save_message = 'No patch data to save or no path provided.'

        # --- Save Patch Data ---
        if self._file_path and not self.cache.empty:
            try:
                patch_reset = self.cache.reset_index(drop=False)
                patch_table = pa.Table.from_pandas(patch_reset, schema=PATCH_SCHEMA)
                pq.write_table(patch_table, self._file_path)
                patch_save_message = f'Successfully saved patch data to {self._file_path}'
            except Exception as e:
                patch_save_success = False
                patch_save_message = f'Failed to save patch data: {str(e)}'
        if patch_save_success:
            return {'success': True, 'message': patch_save_message}
        else:
            return {'success': False, 'message': patch_save_message}

    def _get_parent_global_id(self, level: int, global_id: int) -> int:
        """Method to get parent global id
        Args:
            level (int): level of provided cell
            global_id (int): global_id of provided cell
        Returns:
            parent_global_id (int): parent global id of provided cell
        """
        total_width = self.level_info[level]['width']
        sub_width = self.subdivide_rules[level - 1][0]
        sub_height = self.subdivide_rules[level - 1][1]
        u = global_id % total_width
        v = global_id // total_width
        return (v // sub_height) * self.level_info[level - 1]['width'] + (u // sub_width)
    
    def _get_coordinates(self, level: int, global_ids: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Method to calculate coordinates for provided cells having same level
        
        Args:
            level (int): level of provided cells
            global_ids (list[int]): global_ids of provided cells
        Returns:
            coordinates (tuple[list[float], list[float], list[float], list[float]]): coordinates of provided cells, orgnized by tuple of (min_xs, min_ys, max_xs, max_ys)
        """
        bbox = self.bounds
        width = self.level_info[level]['width']
        height = self.level_info[level]['height']
        
        golbal_xs = global_ids % width
        global_ys = global_ids // width
        min_xs = bbox[0] + (bbox[2] - bbox[0]) * golbal_xs / width
        min_ys = bbox[1] + (bbox[3] - bbox[1]) * global_ys / height
        max_xs = bbox[0] + (bbox[2] - bbox[0]) * (golbal_xs + 1) / width
        max_ys = bbox[1] + (bbox[3] - bbox[1]) * (global_ys + 1) / height
        return min_xs, min_ys, max_xs, max_ys

    def _get_children_global_ids(self, level: int, global_id: int) -> list[int] | None:
        if (level < 0) or (level >= len(self.level_info)):
            return None
        
        width = self.level_info[level]['width']
        global_u = global_id % width
        global_v = global_id // width
        sub_width = self.subdivide_rules[level][0]
        sub_height = self.subdivide_rules[level][1]
        sub_count = sub_width * sub_height
        
        base_global_width = width * sub_width
        child_global_ids = [0] * sub_count
        for local_id in range(sub_count):
            local_u = local_id % sub_width
            local_v = local_id // sub_width
            
            sub_global_u = global_u * sub_width + local_u
            sub_global_v = global_v * sub_height + local_v
            child_global_ids[local_id] = sub_global_v * base_global_width + sub_global_u
        
        return child_global_ids
        
    def subdivide_cells(self, levels: list[int], global_ids: list[int]) -> tuple[list[int], list[int]]:
        """
        Subdivide cells by turning off parent cells' activate flag and activating children's activate flags
        if the parent cell is activate and not deleted.

        Args:
            levels (list[int]): Array of levels for each cell to subdivide
            global_ids (list[int]): Array of global IDs for each cell to subdivide

        Returns:
            tuple[list[int], list[int]]: The levels and global IDs of the subdivided cells.
        """
        if not levels or not global_ids:
            return [], []
        
        # Get all parents
        parent_keys = _encode_index_batch(np.array(levels, dtype=np.uint8), np.array(global_ids, dtype=np.uint32))
        existing_parents = [key for key in parent_keys if key in self.cache.index]
        
        if not existing_parents:
            return [], []
        
        # Filter for valid parents (activated and not deleted)
        valid_parents = self.cache.loc[existing_parents]
        valid_parents = valid_parents[(valid_parents[ATTR_ACTIVATE]) & (~valid_parents[ATTR_DELETED])]
        if valid_parents.empty:
            return [], []

        # Collect all child information
        total_children_count = 0
        for parent_key in valid_parents.index:
            level, _ = _decode_cell_key(parent_key)
            rule = self.subdivide_rules[level]
            total_children_count += rule[0] * rule[1]
        
        # Pre-allocate arrays for all child levels and global ids
        all_child_levels = np.empty(total_children_count, dtype=np.uint8)
        all_child_global_ids = np.empty(total_children_count, dtype=np.uint32)
        
        # Process each parent cell
        child_index = 0
        for parent_key in valid_parents.index:
            level, global_id = _decode_cell_key(parent_key)
            child_global_ids = self._get_children_global_ids(level, global_id)
            if not child_global_ids:
                continue
            
            child_level = level + 1
            child_count = len(child_global_ids)
            end_index = child_index + child_count
            
            all_child_levels[child_index:end_index] = child_level
            all_child_global_ids[child_index:end_index] = child_global_ids
            
            # Update the current position
            child_index = end_index
        
        # If no children were added, return early
        if child_index == 0:
            return [], []
        
        # Trim arrays to actual size
        all_child_levels = all_child_levels[:child_index]
        all_child_global_ids = all_child_global_ids[:child_index]
        
        # Create children DataFrame
        children = pd.DataFrame(
            {
                ATTR_DELETED: np.full(child_index, False, dtype=np.bool_),
                ATTR_ACTIVATE: np.full(child_index, True, dtype=np.bool_),
                ATTR_INDEX_KEY: _encode_index_batch(all_child_levels, all_child_global_ids)
            },
            columns=[ATTR_DELETED, ATTR_ACTIVATE, ATTR_INDEX_KEY]
        )
        children.set_index(ATTR_INDEX_KEY, inplace=True)

        # Update existing children and add new ones
        existing_mask = children.index.isin(self.cache.index)
        if existing_mask.any():
            # Update existing children attributes
            existing_indices = children.index[existing_mask]
            self.cache.loc[existing_indices, ATTR_ACTIVATE] = True
            self.cache.loc[existing_indices, ATTR_DELETED] = False
            
            # Add only new children
            new_children = children.loc[~existing_mask]
            if not new_children.empty:
                self.cache = pd.concat([self.cache, new_children])
        else:
            # All children are new
            self.cache = pd.concat([self.cache, children])

        # Deactivate parent cells
        self.cache.loc[valid_parents.index, ATTR_ACTIVATE] = False

        return all_child_levels.tolist(), all_child_global_ids.tolist()
    
    def delete_cells(self, levels: list[int], global_ids: list[int]):
        """
        Method to delete cells.

        Args:
            levels (list[int]): levels of cells to delete
            global_ids (list[int]): global_ids of cells to delete
        """
        cell_keys = _encode_index_batch(np.array(levels, dtype=np.uint8), np.array(global_ids, dtype=np.uint32))
        existing_cells = [key for key in cell_keys if key in self.cache.index]
        
        if len(existing_cells) == 0:
            return
        
        # Filter for valid grids
        cells = self.cache.loc[existing_cells]
        cells = cells[cells[ATTR_ACTIVATE] & (~cells[ATTR_DELETED])]
        if cells.empty:
            return
        
        # Update deleted status
        self.cache.loc[cells.index, ATTR_DELETED] = True
        self.cache.loc[cells.index, ATTR_ACTIVATE] = False
    
    def get_cell_bboxes(self, levels: list[int], global_ids: list[int]) -> list[float]:
        """Method to get bounding boxes of cells

        Args:
            levels (list[int]): levels of the cells
            global_ids (list[int]): global ids of the cells
        Returns:
            list[float]: list of bounding boxes of the cells, formatted as [cell1_min_x, cell1_min_y, cell1_max_x, cell1_max_y, cell2_min_x, cell2_min_y, cell2_max_x, cell2_max_y, ...]
        """
        if not levels or not global_ids:
            return []
        
        levels_np = np.array(levels, dtype=np.uint8)
        global_ids_np = np.array(global_ids, dtype=np.uint32)
        result_array = np.empty((len(levels), 4), dtype=np.float64)
        
        # Process according to levels
        unique_levels = np.unique(levels_np)
        for level in unique_levels:
            levels_mask = levels_np == level
            current_global_ids = global_ids_np[levels_mask]
            original_indices = np.where(levels_mask)[0]
            
            min_xs, min_ys, max_xs, max_ys = self._get_coordinates(level, current_global_ids)
            result_array[original_indices] = np.column_stack((min_xs, min_ys, max_xs, max_ys))
            
        return result_array.flatten().tolist() 

    def merge_cells(self, levels: list[int], global_ids: list[int]) -> tuple[list[int], list[int]]:
        """
        Merges multiple child cells into their respective parent cell

        This operation typically deletes the specified child cell records and
        activates their common parent cell.  
        Merging is only possible if all child cells are provided.
        Args:
            levels (list[int]): The levels of the child cells to be merged.
            global_ids (list[int]): The global IDs of the child cells to be merged.

        Returns:
            tuple[list[int], list[int]]: The levels and global IDs of the activated parent cells.
        """
        if not levels or not global_ids:
            return [], []
        
        # Get all parent candidates from the provided child grids
        parent_candidates: list[tuple[int, int]] = []
        for level, global_id in zip(levels, global_ids):
            if level == 1:
                continue
            else:
                parent_level = level - 1
                parent_global_id = self._get_parent_global_id(level, global_id)
                parent_candidates.append((parent_level, parent_global_id))
        if not parent_candidates:
            return [], []
        
        # Get parents keys if all children are provided
        keys_to_activate = []
        parent_count = Counter(parent_candidates)
        activated_parents: list[tuple[int, int]] = []
        for (parent_level, parent_global_id), count in parent_count.items():
            sub_width, sub_height = self.subdivide_rules[parent_level]
            expected_children_count = sub_width * sub_height
            
            if count == expected_children_count:
                encoded_idx = _encode_index(parent_level, parent_global_id)
                if encoded_idx in self.cache.index:
                    keys_to_activate.append(encoded_idx)
                    activated_parents.append((parent_level, parent_global_id))

        if not activated_parents:
            return [], []
        
        # Batch activate parent cells
        if keys_to_activate:
            self.cache.loc[keys_to_activate, ATTR_ACTIVATE] = True
        
        # Get all children of activated parents
        keys_to_delete = []
        for parent_level, parent_global_id in activated_parents:
            child_level = parent_level + 1
            child_global_ids = self._get_children_global_ids(parent_level, parent_global_id)
            if child_global_ids:
                for child_global_id in child_global_ids:
                    encoded_idx = _encode_index(child_level, child_global_id)
                    if encoded_idx in self.cache.index:
                        keys_to_delete.append(encoded_idx)
        
        # Batch delete child cell records
        if keys_to_delete:
            self.cache.drop(index=keys_to_delete, inplace=True)
        
        result_levels, result_global_ids = zip(*activated_parents)
        return list(result_levels), list(result_global_ids)
    
    def restore_cells(self, levels: list[int], global_ids: list[int]):
        """Recovers multiple deleted cells by activating them

        Args:
            levels (list[int]): The levels of the cells to be recovered.
            global_ids (list[int]): The global IDs of the cells to be recovered.
        """
        if not levels or not global_ids:
            return
        
        # Get all keys to recover
        encoded_keys = _encode_index_batch(np.array(levels, dtype=np.uint8), np.array(global_ids, dtype=np.uint32))
        cells = [key for key in encoded_keys if key in self.cache.index]
        
        if len(cells) == 0:
            return
        
        # Activate these cells
        self.cache.loc[cells, ATTR_ACTIVATE] = True
        self.cache.loc[cells, ATTR_DELETED] = False

    def get_activated_cell_infos(self) -> tuple[list[int], list[int]]:
        """Method to get all activated cells' global ids and levels

        Returns:
            tuple[list[int], list[int]]: activated cells' global ids and levels
        """
        activated_cells = self.cache[self.cache[ATTR_ACTIVATE] == True]
        levels, global_ids = _decode_index_batch(activated_cells.index.values)
        return levels.tolist(), global_ids.tolist()
    
    def get_deleted_cell_infos(self) -> tuple[list[int], list[int]]:
        """Method to get all deleted cells' global ids and levels
        Returns:
            tuple[list[int], list[int]]: deleted cells' global ids and levels
        """
        deleted_cells = self.cache[self.cache[ATTR_DELETED] == True]
        levels, global_ids = _decode_index_batch(deleted_cells.index.values)
        return levels.tolist(), global_ids.tolist()

    def terminate(self) -> bool:
        """Save the patch data to Parquet file
        Returns:
            bool: Whether the save was successful
        """
        try:
            result = self._save()
            if not result['success']:
                raise Exception(result['message'])
            logger.info(result['message'])
            return True
        except Exception as e:
            logger.error(f'Error saving data: {str(e)}')
            return False

    def save(self) -> PatchSaveInfo:
        """
        Save the patch data to an Parquet file with optimized memory usage.
        This method writes the patch dataframe to disk using Parquet format.
        It processes the data in batches to minimize memory consumption during saving.
        Returns:
            SaveInfo: An object containing:
                - 'success': Boolean indicating success (True) or failure (False)
                - 'message': A string with details about the operation result
        Error conditions:
            - Returns failure if no file path is set
            - Returns failure if the grid dataframe is empty
            - Returns failure with exception details if any error occurs during saving
        """
        save_info_dict = self._save()
        logger.info(save_info_dict['message'])
        save_info = PatchSaveInfo(
            success=save_info_dict.get('success', False),
            message=save_info_dict.get('message', '')
        )
        return save_info
    
# Helpers ##################################################

def _encode_index(level: int, global_id: int) -> np.uint64:
    """Encode level and global_id into a single index key"""
    return np.uint64(level) << 32 | np.uint64(global_id)

def _decode_cell_key(encoded: np.uint64) -> tuple[int, int]:
    """Decode the index key into level and global_id"""
    level = int(encoded >> 32)
    global_id = int(encoded & 0xFFFFFFFF)
    return level, global_id

def _encode_index_batch(levels: np.ndarray, global_ids: np.ndarray) -> np.ndarray:
    """Encode multiple levels and global_ids into a single index key array"""
    return (levels.astype(np.uint64) << 32) | global_ids.astype(np.uint64)

def _decode_index_batch(encoded: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Decode a batch of index keys into levels and global_ids"""
    levels = (encoded >> 32).astype(np.uint8)
    global_ids = (encoded & 0xFFFFFFFF).astype(np.uint32)
    return levels, global_ids
