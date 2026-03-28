import os
import json
import shutil
import tarfile
import logging
from pathlib import Path
from pynoodle import noodle

from .assembly import assembly
from crms.grid import HydroElements, HydroSides, BlockGenerator
from .vector import write_ns, write_ne, apply_vector_modification, get_ne, get_ns

logger = logging.getLogger(__name__)

# --- Lifecycle Hooks ---

def MOUNT(node_key: str, params: dict | None = None):
    """
    Mounts a Grid resource.
    
    If 'assembly' params are provided, it performs the grid assembly (compilation).

        If 'vector' params are provided, it handles vector data processing.
    Both can be present simultaneously.
    Otherwise, it treats it as mounting an existing grid resource.
    """
    assembly_params = params.get('assembly', {})
    rel_path = node_key.strip('.').replace('.', os.sep)
    # Correctly align with where resources should be mounted.
    # Assuming standard pynoodle structure: <project_root>/resource/<rel_path>
    resource_dir = Path.cwd() / 'resource' / rel_path
    resource_dir.mkdir(parents=True, exist_ok=True)
    
    if not params:
        _create_default_meta_if_not_exists(resource_dir)
        return
    
    # Handle assembly if present
    if 'assembly' in params:
        _handle_assembly(assembly_params, node_key, resource_dir)
    
    # Handle vector if present
    if 'vector' in params and params['vector']:
        _handle_vector_modification(params, resource_dir)


# ===== Grid Mount Handlers =====
def _handle_assembly(assembly_params: dict, node_key: str, resource_dir: Path):
    """处理网格装配逻辑"""
    schema_node_key = assembly_params.get('schema_node_key')
    patch_node_keys = assembly_params.get('patch_node_keys')
    grading_threshold = -1
    dem_path = assembly_params.get('dem_path')
    lum_path = assembly_params.get('lum_path')
    meta_path = resource_dir / 'grid.meta.json'

    if not schema_node_key or not patch_node_keys:
        raise ValueError("Assembly requires 'schema_node_key' and 'patch_node_keys'.")

    print(f"Starting assembly for grid: {node_key}")
    try:
        meta_info = assembly(resource_dir, schema_node_key, patch_node_keys, grading_threshold, dem_path, lum_path)
        ne = HydroElements(str(resource_dir / 'cell_topo.bin'))
        ns = HydroSides(str(resource_dir / 'edge_topo.bin'))
        ne.export_ne(str(resource_dir / 'ne.txt'))
        ns.export_ns(str(resource_dir / 'ns.txt'))

        print(f"Total elements loaded for block generation: {len(ne.es)}")
        blocks_output_dir = resource_dir / 'blocks'
        generator = BlockGenerator(output_dir=str(blocks_output_dir), base_name=node_key)
        generator.process(ne.es)

        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(meta_info, f, indent=4)
    except Exception as e:
        logger.error(f"Error during assembly for {node_key}: {e}")
        raise

def _handle_vector_modification(params: dict, resource_dir: Path):
    """处理矢量数据修改逻辑"""
    # Load existing NE and NS files
    ne_path = resource_dir / 'ne.txt'
    ns_path = resource_dir / 'ns.txt'
    
    if not (ne_path.exists() and ns_path.exists()):
        logger.warning(f"NE or NS files not found at {resource_dir}. Skipping vector modification.")
        return
    
    try:
        # Load the existing data
        ne_data = get_ne(ne_path)

        ns_data = get_ns(ns_path)

        # Prepare model data dictionary
        model_data = {
            'ne': ne_data,
            'ns': ns_data
        }
        
        # Apply vector modifications
        modified_model_data = apply_vector_modification(params, model_data)

        # Extract modified data
        modified_ne_data = modified_model_data['ne']
        modified_ns_data = modified_model_data['ns']
        
        # Write the modified data back to files
        write_ne(ne_path, modified_ne_data)
        write_ns(ns_path, modified_ns_data)
        
        logger.info(f"Successfully applied vector modifications and updated NE and NS files.")
    except Exception as e:
        logger.error(f"Error during vector modification: {e}")
        raise

def _create_default_meta_if_not_exists(resource_dir: Path):
    """如果不存在则创建默认元数据文件"""
    meta_path = resource_dir / 'grid.meta.json'
    if not meta_path.exists():
        default_meta = {
            'epsg': 4326,
            'bounds': [0.0, 0.0, 0.0, 0.0],
            'grid_info': [],
            'level_info': [],
            'subdivide_rules': [],
            'alignment_origin': [0.0, 0.0],
            'description': 'Initialized empty grid resource'
        }
        try:
            with open(meta_path, 'w', encoding='utf-8') as f:
                json.dump(default_meta, f, indent=4)
            print(f"Created default grid.meta.json at {meta_path}")
        except Exception as e:
            print(f"Warning: Failed to create default grid.meta.json: {e}")
            raise

def UNMOUNT(node_key: str):
    """
    Unmounts a Grid resource by removing its directory.
    """
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_dir = Path.cwd() / 'resource' / rel_path
    
    if resource_dir.exists():
        try:
            shutil.rmtree(resource_dir)
            print(f"Grid resource at {resource_dir} unmounted and removed.")
        except Exception as e:
            print(f"Error unmounting grid {node_key}: {e}")

def PRIVATIZATION(node_key: str, mount_params: dict | None = None) -> dict:
    """
    Generates launch parameters for the Grid resource.
    """
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_dir = Path.cwd() / 'resource' / rel_path
    
    # Ensure parent structure exists, though MOUNT handles specific dir creation
    resource_dir.parent.mkdir(parents=True, exist_ok=True)
    
    return {
        'resource_space': str(resource_dir)
    }

def PACK(node_key: str, output_path: str) -> tuple[str, int]:
    """
    Packs the Grid resource directory into a .tar.gz file.
    """
    try:
        # Load node record to get resource path
        node_record = noodle._load_node_record(node_key, is_cascade=False)
        launch_params = json.loads(node_record.launch_params)
        resource_space = launch_params.get('resource_space')
        
        if not resource_space:
             # Fallback if launch params missing
            rel_path = node_key.strip('.').replace('.', os.sep)
            resource_space = str(Path.cwd() / 'resource' / rel_path)

        resource_path = Path(resource_space)
        if not resource_path.exists():
             raise FileNotFoundError(f"Resource path {resource_path} does not exist for packing.")

        with tarfile.open(output_path, 'w:gz') as tar:
             tar.add(resource_path, arcname='.')
        
        file_size = os.path.getsize(output_path)
        return output_path, file_size
        
    except Exception as e:
        raise Exception(f"Error packing Grid node {node_key}: {e}")

def UNPACK(target_node_key: str, tar_path: str):
    """
    Unpacks a Grid resource from a .tar.gz file into its workspace.
    """
    try:
        node_record = noodle._load_node_record(target_node_key, is_cascade=False)
        launch_params = json.loads(node_record.launch_params)
        resource_space = launch_params.get('resource_space')
        
        if not resource_space:
            rel_path = target_node_key.strip('.').replace('.', os.sep)
            resource_space = str(Path.cwd() / 'resource' / rel_path)
            
        dest_path = Path(resource_space)
        dest_path.mkdir(parents=True, exist_ok=True)
        
        with tarfile.open(tar_path, 'r:gz') as tar:
            tar.extractall(path=dest_path)
            
    except Exception as e:
        raise Exception(f"Error unpacking Grid node {target_node_key}: {e}")

