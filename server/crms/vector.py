import os
import json
import shutil
import zipfile
from typing import Any
from pathlib import Path
from osgeo import ogr, osr
from pydantic import BaseModel
from icrms.ivector import UpdateFeatureBody

import logging
logger = logging.getLogger(__name__)

DEFAULT_EPSG = '4326'  # Default EPSG code for GeoJSON storage

class VectorMeta(BaseModel):
    name: str
    epsg: str | None
    color: str | None

class Vector:
    """
    CRM
    =
    The Vector Resource.  
    Vector is a geometry feature file that can be uploaded to the resource pool.  
    """
    def __init__(self, workspace: str):
        self.path = Path(workspace)

        self.meta_path = self.path / 'meta.json'
        if not self.path.exists():
            raise FileNotFoundError(f'Workspace path {workspace} does not exist')
        
        # meta: VectorMeta = VectorMeta.model_dump_json(loads=self.meta_path.read_text(encoding='utf-8'))
        meta: VectorMeta = VectorMeta.model_validate_json(self.meta_path.read_text(encoding='utf-8'))
        self.name = meta.name
        self.epsg = meta.epsg
        self.color = meta.color
    
    def get_epsg_code(self) -> str:
        if self.epsg:
            return self.epsg
        else:
            with open(self.meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
            return meta.get('epsg', DEFAULT_EPSG)
    
    def get_geojson_string(self) -> str:
        file_path = os.path.join(self.path, self.name + '.geojson')
        with open(file_path, 'r', encoding='utf-8') as f:
            geojson_str = f.read()
        return geojson_str
        
    def save_feature(self, feature_json: dict[str, Any]) -> dict[str, bool | str]:
        feature_path = self.path / f'{self.name}.geojson'
        try:
            # Ensure the feature_json is in FeatureCollection format
            feature_collection = self._ensure_feature_collection(feature_json)
            
            # Clean invalid features
            feature_collection = self._clean_invalid_feature(feature_collection)
            
            with open(feature_path, 'w', encoding='utf-8') as f:
                json.dump(feature_collection, f, ensure_ascii=False, indent=2)
            return {
                'success': True,
                'message': 'Feature saved successfully as FeatureCollection'
            }
        except Exception as e:
            logger.error(f'Failed to save feature: {str(e)}')
            return {
                'success': False,
                'message': str(e)
            }

    def save_uploaded_feature(self, file_path: str) -> dict[str, bool | str]:
        feature_path = self.path / f'{self.name}.geojson'
        file_type = Path(file_path).suffix.lower().strip('.')
        try:
            if file_type == 'shp':
                feature_json, source_epsg = self._shp_to_geojson_with_epsg(file_path)
                # Shapefile conversion already returns FeatureCollection
            elif file_type == 'geojson':
                with open(file_path, 'r', encoding='utf-8') as f:
                    raw_data = json.load(f)
                # Ensure uploaded GeoJSON is in FeatureCollection format
                feature_json = self._ensure_feature_collection(raw_data)
                source_epsg = self._detect_geojson_epsg(feature_json)
            else:
                raise ValueError(f'Unsupported file type: {file_type}')
            
            # # Convert to EPSG:4326 for storage if needed
            # if source_epsg and source_epsg != DEFAULT_EPSG:
            #     logger.info(f'Converting feature from EPSG:{source_epsg} to EPSG:{DEFAULT_EPSG} for storage')
            #     feature_json = self._transform_geojson_coordinates(feature_json, source_epsg, DEFAULT_EPSG)
            
            self.epsg = source_epsg
            
            with open(feature_path, 'w', encoding='utf-8') as f:
                json.dump(feature_json, f, ensure_ascii=False, indent=2)
                
            with open(self.meta_path, 'w', encoding='utf-8') as f:
                meta = VectorMeta(
                    name=self.name,
                    epsg=self.epsg,
                    color=self.color
                )
                f.write(meta.model_dump_json(indent=2))
                
            return {
                'success': True,
                'message': f'Feature saved successfully as FeatureCollection (converted from EPSG:{source_epsg} to EPSG:{DEFAULT_EPSG})' if source_epsg and source_epsg != DEFAULT_EPSG else 'Feature saved successfully as FeatureCollection'
            }
        except Exception as e:
            logger.error(f'Failed to save feature: {str(e)}')
            return {
                'success': False,
                'message': str(e)
            }

    def get_feature(self, target_epsg: str = DEFAULT_EPSG) -> dict[str, Any]:
        """
        Get feature json
        """
        file_path = os.path.join(self.path, self.name + '.geojson')
        
        with open(file_path, 'r', encoding='utf-8') as f:
            feature_json = json.load(f)
            
        
        if self.epsg != target_epsg:
            logger.info(f'Transforming GeoJSON coordinates from EPSG:{self.epsg} to EPSG:{target_epsg}')
            feature_json = self._transform_geojson_coordinates(feature_json, self.epsg, target_epsg)
            
        return {
            'name': self.name,
            'color': self.color,
            'epsg': self.epsg,
            'feature_json': feature_json
        }

    def get_feature_json_computation(self) -> dict[str, Any]:
        """
        Get feature json for computation
        Transform coordinates from EPSG:4326 (storage CRS) to self.epsg (computation CRS)
        """
        file_path = os.path.join(self.path, self.name + '.geojson')
        with open(file_path, 'r', encoding='utf-8') as f:
            geojson_data = json.load(f)
        
        # If target EPSG is the same as storage EPSG (4326), return as is
        if self.epsg == DEFAULT_EPSG:
            logger.info('No transformation needed, returning GeoJSON as is')
            return geojson_data
        logger.info(f'Transforming GeoJSON coordinates from EPSG:4326 to EPSG:{self.epsg}')
        # Transform coordinates from 4326 to target EPSG
        return self._transform_geojson_coordinates(geojson_data, DEFAULT_EPSG, self.epsg)

    def update_feature(self, update_body: UpdateFeatureBody) -> dict[str, bool | str]:
        self.epsg = update_body.epsg
        self.color = update_body.color
        feature_json = update_body.feature_json
        
        # Update meta information
        meta = VectorMeta(
            name=self.name,
            epsg=self.epsg,
            color=self.color
        )
        with open(self.meta_path, 'w', encoding='utf-8') as f:
            f.write(meta.model_dump_json(indent=2))
        
        # Ensure the feature_json is in FeatureCollection format
        file_path = os.path.join(self.path, self.name + '.geojson')
        try:
            # Ensure the feature_json is in FeatureCollection format
            feature_collection = self._ensure_feature_collection(feature_json)
            
            # Clean invalid features
            feature_collection = self._clean_invalid_feature(feature_collection)
            
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(feature_collection, f, ensure_ascii=False, indent=2)
            return {
                'success': True,
                'message': 'Feature updated successfully',
            }
        except Exception as e:
            logger.error(f'Failed to update feature: {str(e)}')
            return {
                'success': False,
                'message': str(e)
            }
        
    def delete_feature(self) -> dict[str, bool | str]:
        """
        Delete feature
        """
        if os.path.exists(self.path):
            try:
                # Use shutil.rmtree to remove directory and all its contents
                shutil.rmtree(self.path)
                return {
                    'success': True,
                    'message': 'Feature deleted successfully',
                }
            except PermissionError as e:
                logger.error(f'Permission denied when deleting feature: {str(e)}')
                return {
                    'success': False,
                    'message': f'Permission denied: {str(e)}',
                }
            except Exception as e:
                logger.error(f'Failed to delete feature: {str(e)}')
                return {
                    'success': False,
                    'message': f'Failed to delete feature: {str(e)}',
                }
        else:
            return {
                'success': False,   
                'message': 'Feature not found',
            }
 
    def _shp_to_geojson(self, shp_path):
        # If input is a zip file, unzip first
        if shp_path.endswith('.zip'):
            shp_path = self._unzip_and_get_shp(shp_path)
        # Open the shp file
        driver = ogr.GetDriverByName('ESRI Shapefile')
        dataSource = driver.Open(shp_path, 0)  # 0 means read-only

        if dataSource is None:
            raise FileNotFoundError(f'Unable to open {shp_path}')
        layer = dataSource.GetLayer()

        # Construct GeoJSON FeatureCollection
        geojson = {
            'type': 'FeatureCollection',
            'features': []
        }

        # Detect EPSG code
        prj_path = os.path.splitext(shp_path)[0] + '.prj'
        crs_wkt = None
        if os.path.exists(prj_path):
            with open(prj_path, 'r', encoding='utf-8') as prj_file:
                crs_wkt = prj_file.read().strip()
        if crs_wkt:
            geojson['crs_wkt'] = crs_wkt

        # Iterate over all features
        for feature in layer:
            geom = feature.GetGeometryRef()
            # Convert to GeoJSON geometry dictionary
            geom_json = json.loads(geom.ExportToJson())

            # Read attribute table
            properties = {}
            feature_defn = layer.GetLayerDefn()
            for i in range(feature_defn.GetFieldCount()):
                field_defn = feature_defn.GetFieldDefn(i)
                field_name = field_defn.GetNameRef()
                properties[field_name] = feature.GetField(i)

            # Assemble single feature
            geojson_feature = {
                'type': 'Feature',
                'geometry': geom_json,
                'properties': properties
            }
            geojson['features'].append(geojson_feature)
        return geojson

    def _unzip_and_get_shp(self, zip_path):
        """
        Unzip the zip file and return the path to the shp file inside
        """
        # Create temporary directory
        temp_dir = str(self.path / 'temp')
        # Unzip the zip file
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)
        # Find shp file
        shp_path = None
        for root, dirs, files in os.walk(temp_dir):
            for file in files:
                if file.endswith('.shp'):
                    shp_path = os.path.join(root, file)
                    break
            if shp_path:
                break
        if not shp_path:
            raise FileNotFoundError('Shapefile not found in the zip archive')
        return shp_path
    
    def _transform_geojson_coordinates(self, geojson_data: dict, source_epsg: str, target_epsg: str) -> dict:
        """
        Transform GeoJSON coordinates from source EPSG to target EPSG
        
        Args:
            geojson_data: GeoJSON FeatureCollection with coordinates in source CRS
            source_epsg: Source EPSG code (e.g., "4326")
            target_epsg: Target EPSG code (e.g., "3857")
            
        Returns:
            GeoJSON FeatureCollection with transformed coordinates
        """
        try:
            # Create spatial reference systems
            source_srs = osr.SpatialReference()
            source_srs.ImportFromEPSG(int(source_epsg))
            # Set axis mapping to traditional GIS order (longitude, latitude)
            source_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            
            target_srs = osr.SpatialReference()
            target_srs.ImportFromEPSG(int(target_epsg))
            # Set axis mapping to traditional GIS order (longitude, latitude)
            target_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            
            # Transform coordinates for each feature in the FeatureCollection
            features = geojson_data.get('features', [])
            for feature in features:
                if feature.get('geometry'):
                    self._transform_geometry_ogr(feature['geometry'], source_srs, target_srs)
            
            return geojson_data
            
        except Exception as e:
            logger.error(f'Failed to transform coordinates from EPSG:{source_epsg} to EPSG:{target_epsg}: {str(e)}')
            # Return original data if transformation fails
            return geojson_data
    
    def _transform_geometry_ogr(self, geometry: dict, source_srs, target_srs) -> None:
        """
        Transform geometry using OGR's built-in transformation
        
        Args:
            geometry: GeoJSON geometry object
            source_srs: Source spatial reference system
            target_srs: Target spatial reference system
        """
        try:
            # Convert GeoJSON geometry to OGR geometry
            geom_str = json.dumps(geometry)
            ogr_geom = ogr.CreateGeometryFromJson(geom_str)
            
            if ogr_geom is None:
                logger.warning(f"Failed to create OGR geometry from: {geometry}")
                return
            
            # Assign source coordinate system
            ogr_geom.AssignSpatialReference(source_srs)
            
            # Transform to target coordinate system
            ogr_geom.TransformTo(target_srs)
            
            # Convert back to GeoJSON and update the original geometry
            transformed_json = json.loads(ogr_geom.ExportToJson())
            geometry.update(transformed_json)
            
        except Exception as e:
            logger.error(f'Failed to transform geometry using OGR: {str(e)}')
            # Keep original geometry if transformation fails
    
    def _shp_to_geojson_with_epsg(self, shp_path):
        """
        Convert shapefile to GeoJSON and detect EPSG
        
        Returns:
            tuple: (geojson_dict, epsg_code)
        """
        # If input is a zip file, unzip first
        if shp_path.endswith('.zip'):
            shp_path = self._unzip_and_get_shp(shp_path)
        
        # Open the shp file
        driver = ogr.GetDriverByName('ESRI Shapefile')
        dataSource = driver.Open(shp_path, 0)  # 0 means read-only
        if dataSource is None:
            raise FileNotFoundError(f'Cannot open {shp_path}')

        layer = dataSource.GetLayer()
        
        # Detect EPSG code
        epsg_code = None
        srs = layer.GetSpatialRef()
        if srs:
            try:
                epsg_code = srs.GetAuthorityCode(None)
                if epsg_code:
                    epsg_code = str(epsg_code)
                    logger.info(f'Detected EPSG code from shapefile: {epsg_code}')
            except Exception as e:
                logger.warning(f'Failed to get EPSG code from shapefile: {str(e)}')

        # Construct GeoJSON FeatureCollection
        geojson = {
            'type': 'FeatureCollection',
            'features': []
        }

        # Read .prj file (coordinate reference)
        prj_path = os.path.splitext(shp_path)[0] + '.prj'
        crs_wkt = None
        if os.path.exists(prj_path):
            with open(prj_path, 'r', encoding='utf-8') as prj_file:
                crs_wkt = prj_file.read().strip()
            
            # If EPSG cannot be obtained from SRS, try to parse from WKT
            if not epsg_code and crs_wkt:
                try:
                    temp_srs = osr.SpatialReference()
                    temp_srs.ImportFromWkt(crs_wkt)
                    # Set axis mapping to traditional GIS order (longitude, latitude)
                    temp_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
                    epsg_code = temp_srs.GetAuthorityCode(None)
                    if epsg_code:
                        epsg_code = str(epsg_code)
                        logger.info(f'Detected EPSG code from PRJ file: {epsg_code}')
                except Exception as e:
                    logger.warning(f'Failed to parse EPSG from PRJ file: {str(e)}')

        if crs_wkt:
            geojson['crs_wkt'] = crs_wkt

        # Iterate over all features
        for feature in layer:
            geom = feature.GetGeometryRef()
            # Convert to GeoJSON geometry dictionary
            geom_json = json.loads(geom.ExportToJson())

            # Read attribute table
            properties = {}
            feature_defn = layer.GetLayerDefn()
            for i in range(feature_defn.GetFieldCount()):
                field_defn = feature_defn.GetFieldDefn(i)
                field_name = field_defn.GetNameRef()
                properties[field_name] = feature.GetField(i)

            # Assemble single feature
            geojson_feature = {
                'type': 'Feature',
                'geometry': geom_json,
                'properties': properties
            }
            geojson['features'].append(geojson_feature)

        return geojson, epsg_code

    def _detect_geojson_epsg(self, geojson_data: dict) -> str:
        """
        Detect EPSG code from GeoJSON data
        
        Args:
            geojson_data: GeoJSON data
            
        Returns:
            EPSG code as string, or None if not detected
        """
        try:
            # Check for CRS information in GeoJSON
            crs = geojson_data.get('crs')
            if crs:
                # Standard GeoJSON CRS format
                if crs.get('type') == 'name':
                    crs_name = crs.get('properties', {}).get('name', '')
                    if 'EPSG:' in crs_name:
                        epsg_code = crs_name.split('EPSG:')[-1]
                        logger.info(f'Detected EPSG code from GeoJSON CRS: {epsg_code}')
                        return epsg_code
                
                # Link-based CRS format
                elif crs.get('type') == 'link':
                    href = crs.get('properties', {}).get('href', '')
                    if 'epsg.io' in href or 'EPSG:' in href:
                        import re
                        match = re.search(r'EPSG:?(\d+)', href)
                        if match:
                            epsg_code = match.group(1)
                            logger.info(f'Detected EPSG code from GeoJSON link: {epsg_code}')
                            return epsg_code

            # Check for WKT CRS information (custom extension)
            crs_wkt = geojson_data.get('crs_wkt')
            if crs_wkt:
                try:
                    srs = osr.SpatialReference()
                    srs.ImportFromWkt(crs_wkt)
                    # Set axis mapping to traditional GIS order (longitude, latitude)
                    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
                    epsg_code = srs.GetAuthorityCode(None)
                    if epsg_code:
                        epsg_code = str(epsg_code)
                        logger.info(f'Detected EPSG code from GeoJSON WKT: {epsg_code}')
                        return epsg_code
                except Exception as e:
                    logger.warning(f'Failed to parse EPSG from WKT: {str(e)}')

            # If no CRS information found, assume WGS84 (EPSG:4326)
            logger.info('No CRS information found in GeoJSON, assuming EPSG:4326')
            return DEFAULT_EPSG

        except Exception as e:
            logger.error(f'Error detecting EPSG from GeoJSON: {str(e)}')
            # Default to WGS84 if detection fails
            return DEFAULT_EPSG

    def _ensure_feature_collection(self, geojson_data: dict[str, Any]) -> dict[str, Any]:
        """
        Ensure the GeoJSON data is in FeatureCollection format
        
        Args:
            geojson_data: GeoJSON data (could be Feature, FeatureCollection, or geometry)
            
        Returns:
            GeoJSON data in FeatureCollection format
        """
        if not isinstance(geojson_data, dict):
            raise ValueError('Invalid GeoJSON data: must be a dictionary')
        
        geojson_type = geojson_data.get('type')
        if geojson_type == 'FeatureCollection':
            # Already a FeatureCollection, return as is
            return geojson_data
        
        elif geojson_type == 'Feature':
            # Convert single Feature to FeatureCollection
            return {
                'type': 'FeatureCollection',
                'features': [geojson_data]
            }
        
        elif geojson_type in ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon', 'GeometryCollection']:
            # Convert geometry to Feature, then to FeatureCollection
            feature = {
                'type': 'Feature',
                'geometry': geojson_data,
                'properties': {}
            }
            return {
                'type': 'FeatureCollection', 
                'features': [feature]
            }
        
        else:
            raise ValueError(f'Unsupported GeoJSON type: {geojson_type}')
    
    def _clean_invalid_feature(self, feature_collection: dict[str, Any]) -> dict[str, Any]:
        """
        Clean invalid features from a FeatureCollection
        
        Args:
            feature_collection: GeoJSON FeatureCollection
        """
        if feature_collection.get('type') != 'FeatureCollection':
            return feature_collection

        valid_features = []
        original_features = feature_collection.get('features', [])
        
        for feature in original_features:
            geometry = feature.get('geometry')
            # Allow features without geometry (pure attribute features)
            if not geometry:
                valid_features.append(feature)
                continue
            
            geom_type = geometry.get('type')
            coordinates = geometry.get('coordinates')
            if not coordinates:
                logger.warning('Feature with empty coordinates found, skipping')
                continue
            
            # Basic validation for common geometry types
            is_valid = True
            if geom_type == 'Polygon':
                for ring in coordinates:
                    if not isinstance(ring, list) or len(ring) < 4:
                        is_valid = False
                        break
            elif geom_type == 'MultiPolygon':
                for polygon in coordinates:
                    for ring in polygon:
                        if not isinstance(ring, list) or len(ring) < 4:
                            is_valid = False
                            break
            elif geom_type == 'LineString':
                if len(coordinates) < 2:
                    is_valid = False
            
            if is_valid:
                valid_features.append(feature)
        
        feature_collection['features'] = valid_features
        return feature_collection
        
    def terminate(self):
        """
        Terminate the resource, clean up if necessary
        """
        pass
    