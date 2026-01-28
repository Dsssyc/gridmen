import logging
from pathlib import Path
from osgeo import ogr, osr
from pynoodle import noodle
import multiprocessing as mp
from functools import partial
from fastapi import APIRouter, HTTPException, Response, Body

from ...schemas.base import BaseResponse
from ...schemas.patch import PatchMeta, MultiCellInfo, PickByFeatureRequest

from icrms.ivector import IVector
from icrms.ipatch import IPatch, PatchSaveInfo, PatchSchema

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
ogr.UseExceptions()

# APIs for grid patch ################################################

router = APIRouter(prefix='/patch', tags=['patch-related apis'])

@router.get('/meta', response_model=PatchMeta)
def get_patch_meta(node_key: str, lock_id: str = None):
    try:
        with noodle.connect(IPatch, node_key, 'pr', lock_id=lock_id) as patch:
            patch_meta = patch.get_meta()
            return PatchMeta(
                name=node_key.split('.')[-1],
                epsg=patch_meta.epsg,
                bounds=patch_meta.bounds,
                alignment_origin=patch_meta.alignment_origin,
                subdivide_rules=patch_meta.subdivide_rules,
                schema_node_key=patch_meta.schema_node_key,
                grid_info=patch_meta.grid_info
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to get patch meta information: {str(e)}')

@router.get('/activate-info', response_class=Response, response_description='Returns active cell information in bytes. Format: [4 bytes for length, followed by level bytes, followed by padding bytes, followed by global id bytes]')
def activated_cell_infos(node_key: str, lock_id: str = None):
    try:
        with noodle.connect(IPatch, node_key, 'pr', lock_id=lock_id) as patch:
            levels, global_ids = patch.get_activated_cell_infos()
        cell_infos = MultiCellInfo(levels=levels, global_ids=global_ids)
        
        return Response(
            content=cell_infos.combine_bytes(),
            media_type='application/octet-stream'
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to get active grid information: {str(e)}')

@router.get('/deleted-info', response_class=Response, response_description='Returns deleted cell information in bytes. Format: [4 bytes for length, followed by level bytes, followed by padding bytes, followed by global id bytes]')
def deleted_cell_infos(node_key: str, lock_id: str = None):
    try:
        with noodle.connect(IPatch, node_key, 'pr', lock_id=lock_id) as patch:
            levels, global_ids = patch.get_deleted_cell_infos()
        cell_infos = MultiCellInfo(levels=levels, global_ids=global_ids)
        
        return Response(
            content=cell_infos.combine_bytes(),
            media_type='application/octet-stream'
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to get deleted cell information: {str(e)}')

@router.post('/subdivide', response_class=Response, response_description='Returns subdivided cell information in bytes. Format: [4 bytes for length, followed by level bytes, followed by padding bytes, followed by global id bytes]')
def subdivide_cells(node_key: str, lock_id: str, cell_info_bytes: bytes = Body(..., description='Cell information in bytes. Format: [4 bytes for length, followed by level bytes, followed by padding bytes, followed by global id bytes]')):
    try:
        grid_info = MultiCellInfo.from_bytes(cell_info_bytes)
        with noodle.connect(IPatch, node_key, 'pw', lock_id=lock_id) as patch:
            levels, global_ids = patch.subdivide_cells(grid_info.levels, grid_info.global_ids)
        subdivide_info = MultiCellInfo(levels=levels, global_ids=global_ids)

        return Response(
            content=subdivide_info.combine_bytes(),
            media_type='application/octet-stream'
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to subdivide cells: {str(e)}')

@router.post('/merge', response_class=Response, response_description='Returns merged cell information in bytes. Format: [4 bytes for length, followed by level bytes, followed by padding bytes, followed by global id bytes]')
def merge_cells(node_key: str, lock_id: str,cell_info_bytes: bytes = Body(..., description='Cell information in bytes. Format: [4 bytes for length, followed by level bytes, followed by padding bytes, followed by global id bytes]')):
    """
    Merge cells based on the provided cell information
    """
    try:
        cell_info = MultiCellInfo.from_bytes(cell_info_bytes)
        with noodle.connect(IPatch, node_key, 'pw', lock_id=lock_id) as patch:
            levels, global_ids = patch.merge_cells(cell_info.levels, cell_info.global_ids)
            merge_info = MultiCellInfo(levels=levels, global_ids=global_ids)

        return Response(
            content=merge_info.combine_bytes(),
            media_type='application/octet-stream'
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to merge grids: {str(e)}')
        
@router.post('/delete', response_model=BaseResponse)
def delete_cells(node_key: str, lock_id: str, cell_info_bytes: bytes = Body(..., description='Cell information in bytes. Format: [4 bytes for length, followed by level bytes, followed by padding bytes, followed by global id bytes]')):
    """
    Delete cells based on the provided cell information
    """
    try:
        with noodle.connect(IPatch, node_key, 'pw', lock_id=lock_id) as patch:
            cell_info = MultiCellInfo.from_bytes(cell_info_bytes)
            patch.delete_cells(cell_info.levels, cell_info.global_ids)

        return BaseResponse(
            success=True,
            message='Cells deleted successfully'
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to delete cells: {str(e)}')
    
@router.post('/restore', response_model=BaseResponse)
def restore_cells(node_key: str, lock_id: str, cell_info_bytes: bytes = Body(..., description='Cell information in bytes. Format: [4 bytes for length, followed by level bytes, followed by padding bytes, followed by global id bytes]')):
    """
    Recover cells based on the provided cell information
    """
    try:
        cell_info = MultiCellInfo.from_bytes(cell_info_bytes)
        with noodle.connect(IPatch, node_key, 'pw', lock_id=lock_id) as patch:
            patch.restore_cells(cell_info.levels, cell_info.global_ids)

        return BaseResponse(
            success=True,
            message='Cells recovered successfully'
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to recover cells: {str(e)}')

@router.post('/pick', response_class=Response, response_description='Returns picked cell information in bytes. Format: [4 bytes for length, followed by level bytes, followed by padding bytes, followed by global id bytes]')
def pick_cells_by_feature(request: PickByFeatureRequest):
    """
    Pick cells based on features from a .shp or .geojson file.
    The feature_dir parameter should be a path to the feature file accessible by the server.
    """
    # Prepare target spatial reference
    ##################################
    node_key = request.patch_token.node_key
    lock_id = request.patch_token.lock_id
    file_or_vector_node_key = request.file_or_feature_token
    is_file = isinstance(file_or_vector_node_key, str)
    
    with noodle.connect(IPatch, node_key, 'pr', lock_id=lock_id) as patch:
        schema: PatchSchema = patch.get_meta()
    target_epsg: int = schema.epsg
    target_sr = osr.SpatialReference()
    target_sr.ImportFromEPSG(target_epsg)
    # Ensure axis order is as expected by WKT (typically X, Y or Lon, Lat)
    # For EPSG > 4000, it's often Lat, Lon. For WKT, it's usually Lon, Lat.
    # OGR/GDAL 3+ handles this better, but being explicit can help.
    if int(osr.GetPROJVersionMajor()) >= 3:
        target_sr.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        
    # Get GDAL/OGR data source from file or vector node
    ###################################################
    
    source_sr = None
    data_source = None
    # Get feature path
    if is_file:
        feature_path = file_or_vector_node_key
        # Validate the feature_path parameter
        feature_file = Path(feature_path)
        file_extension = feature_file.suffix.lower()
        if file_extension not in ['.shp', '.geojson']:
            raise HTTPException(status_code=400, detail=f'Unsupported file type: {file_extension}. Must be .shp or .geojson.')
        if not feature_file.exists() or not feature_file.is_file():
            raise HTTPException(status_code=404, detail=f'Feature file not found: {feature_path}')

        try:
            # Set up GDAL/OGR data source
            data_source = ogr.Open(str(feature_file))
            if data_source is None:
                raise ValueError(f'Could not open data source from {feature_path}')
        except Exception as e:
            error_message = f'Error opening data source from {feature_path}: {str(e)}'
            logging.error(error_message)
            raise HTTPException(status_code=500, detail=error_message)
    else:
        vector_key = file_or_vector_node_key.node_key
        vector_lock_id = file_or_vector_node_key.lock_id
        with noodle.connect(IVector, vector_key, 'pr', lock_id=vector_lock_id) as vector:
            geojson_string = vector.get_geojson_string()
            epsg_code = vector.get_epsg_code()
        try:
            # Parse geojson string into OGR data source
            data_source = ogr.Open(f'GeoJSON:{geojson_string}')
            if data_source is None:
                raise ValueError(f'Could not open data source from vector node {vector_key}')
            else:
                # Set EPSG
                source_sr = osr.SpatialReference()
                source_sr.ImportFromEPSG(int(epsg_code))
                # for i in range(data_source.GetLayerCount()):
                #     layer = data_source.GetLayer(i)
                #     if layer is not None:
                #         layer.SetSpatialRef(source_sr)
                
        except Exception as e:
            error_message = f'Error opening data source from vector node {vector_key}: {str(e)}'
            logging.error(error_message)
            raise HTTPException(status_code=500, detail=error_message)
    
    # Extract WKT of geometries from data source
    ############################################
    
    ogr_features = []
    ogr_geometries = []
    for i in range(data_source.GetLayerCount()):
        layer = data_source.GetLayer(i)
        if layer is None:
            logging.warning(f'Could not get layer {i} from {file_or_vector_node_key}')
            continue
        
        # Transform the layer geometries to target spatial reference if needed
        transform = None
        if source_sr is None:
            source_sr = layer.GetSpatialRef()
        
        if source_sr and target_sr and not source_sr.IsSame(target_sr):
            if int(osr.GetPROJVersionMajor()) >= 3:
                source_sr.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            transform = osr.CoordinateTransformation(source_sr, target_sr)
        elif not source_sr:
            raise ValueError(f'Layer {i} in {file_or_vector_node_key} has no spatial reference.')
            
        # Iterate through features in the layer and extract geometries
        layer.ResetReading()
        feature = layer.GetNextFeature()
        while feature:
            geom = feature.GetGeometryRef()
            if geom:
                if transform:
                    geom.Transform(transform)
                    
                ogr_geometries.append(geom)
            ogr_features.append(feature)    # keep reference to avoid premature destruction
            feature = layer.GetNextFeature()
        layer.ResetReading()
    
    # Convert geometries to WKT for easier multiprocessing
    geometry_wkts = [geom.ExportToWkt() for geom in ogr_geometries]
    if not geometry_wkts:
        error_message = f'No valid geometries found in the provided feature source: {file_or_vector_node_key}'
        logger.error(error_message)
        raise HTTPException(status_code=400, detail=error_message)

    # Pick cells based on geometries
    ################################
    
    try:
        # Get centers of all active grids
        with noodle.connect(IPatch, node_key, 'pr', lock_id=lock_id) as patch:
            active_levels, active_global_ids = patch.get_activated_cell_infos()

            if not active_levels or not active_global_ids:
                logging.info(f'No active cells found to check against features from {file_or_vector_node_key}')
                return Response(
                    content=MultiCellInfo(levels=[], global_ids=[]).combine_bytes(),
                    media_type='application/octet-stream'
                )
            bboxes: list[float]  = patch.get_cell_bboxes(active_levels, active_global_ids)
            
        if bboxes is None or len(bboxes) == 0:
            logging.info(f'No cell bounding boxes retrieved from patch {node_key}')
            return Response(
                content=MultiCellInfo(levels=[], global_ids=[]).combine_bytes(),
                media_type='application/octet-stream'
            )

        # Pick cells, centers of which are within the features, accelerate with multiprocessing
        picked_levels: list[int] = []
        picked_global_ids: list[int] = []
        
        # Batch processing
        n_cores = mp.cpu_count()
        total_cells = len(bboxes) // 4
        batch_size = max(100000, total_cells // (n_cores))
        batches = []
        for i in range(0, total_cells, batch_size):
            end_idx = min(i + batch_size, total_cells)
            batch_bboxes = bboxes[i * 4:end_idx * 4]
            batch_levels = [active_levels[idx] for idx in range(i, end_idx)]
            batch_global_ids = [active_global_ids[idx] for idx in range(i, end_idx)]
            batches.append((batch_bboxes, batch_levels, batch_global_ids))
           
        process_func = partial(_process_picking_batch, geometry_wkts=geometry_wkts)
        with mp.Pool(processes=min(n_cores, len(batches))) as pool:
            results = pool.map(process_func, batches)
            
            for batch_levels, batch_global_ids in results:
                picked_levels.extend(batch_levels)
                picked_global_ids.extend(batch_global_ids)

        if not picked_levels:
            logging.info(f'No activate cell centers found within the features from {file_or_vector_node_key}')
            return Response(
                content=MultiCellInfo(levels=[], global_ids=[]).combine_bytes(),
                media_type='application/octet-stream'
            )

        picked_info = MultiCellInfo(levels=picked_levels, global_ids=picked_global_ids)
        return Response(
            content=picked_info.combine_bytes(),
            media_type='application/octet-stream'
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to pick grids by feature: {str(e)}')
    
    finally:
        # Clean up
        for feature in ogr_features:
            if feature:
                feature.Destroy()
        ogr_features.clear()
        ogr_geometries.clear()
        
        if target_sr:
            target_sr = None
        if source_sr:
            source_sr = None
        if data_source:
            data_source = None

@router.get('/save', response_model=BaseResponse)
def save_grids(node_key: str, lock_id: str):
    """
    Save the current grid state to a file.
    """
    try:
        with noodle.connect(IPatch, node_key, 'pw', lock_id=lock_id) as patch:
            result: PatchSaveInfo = patch.save()
            logging.info(f'Grid saved successfully: {result}')
        return BaseResponse(
            success=result.success,
            message=result.message
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to save grid: {str(e)}')

# Helpers ##################################################

def _process_picking_batch(batch_data, geometry_wkts):
    batch_boxes, batch_levels, batch_global_ids = batch_data
    
    geometries = [ogr.CreateGeometryFromWkt(wkt) for wkt in geometry_wkts]
    picked_levels = []
    picked_global_ids = []
    
    box_geometry = ogr.Geometry(ogr.wkbPolygon)
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for i in range(len(batch_boxes) // 4):
        bbox = batch_boxes[i * 4:i * 4 + 4]
        minX, minY, maxX, maxY = bbox
        ring.Empty()
        ring.AddPoint(minX, minY)
        ring.AddPoint(maxX, minY)
        ring.AddPoint(maxX, maxY)
        ring.AddPoint(minX, maxY)
        ring.AddPoint(minX, minY) 
        
        box_geometry.Empty()
        box_geometry.AddGeometry(ring)
        
        for geom in geometries:
            if geom.Intersects(box_geometry) or geom.Contains(box_geometry):
                picked_levels.append(batch_levels[i])
                picked_global_ids.append(batch_global_ids[i])
                break
    
    ring.Destroy()
    box_geometry.Destroy()
    for geom in geometries:
        geom.Destroy()
    
    return picked_levels, picked_global_ids
