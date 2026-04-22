import os
import re
import math
import json
import copy
import logging
import functools
import numpy as np

from typing import List
from pathlib import Path
from pyproj import Transformer
from typing import Dict, Tuple
from dataclasses import dataclass

# --- 针对vector的处理算法 ---
logger = logging.getLogger(__name__)

# 全局缓存的坐标转换器
_transformer_cache: Dict[Tuple[str, str], Transformer] = {}

@dataclass
class NeData:
    grid_id_list: list[int]
    nsl1_list: list[int]
    nsl2_list: list[int]
    nsl3_list: list[int]
    nsl4_list: list[int]
    isl1_list: list[list[int]]
    isl2_list: list[list[int]]
    isl3_list: list[list[int]]
    isl4_list: list[list[int]]
    xe_list: list[float]
    ye_list: list[float]
    ze_list: list[float]
    under_suf_list: list[int]

@dataclass
class NsData:
    edge_id_list: list[int]
    ise_list: list[list[int]]
    dis_list: list[float]
    x_side_list: list[float]
    y_side_list: list[float]
    z_side_list: list[float]
    s_type_list: list[int]

def write_ne(ne_path: str, ne_data: NeData) -> None:
    """
    将NeData对象写入NE文件
    
    Args:
        ne_path: 输出NE文件路径
        ne_data: NeData对象
    """
    with open(ne_path, 'w', encoding='utf-8', newline='') as f:
        # 从1开始遍历，跳过初始占位元素
        for i in range(1, len(ne_data.grid_id_list)):
            # 写入网格ID
            row_parts = [str(ne_data.grid_id_list[i])]
            
            # 写入邻接信息
            row_parts.append(str(ne_data.nsl1_list[i]))
            row_parts.append(str(ne_data.nsl2_list[i]))
            row_parts.append(str(ne_data.nsl3_list[i]))
            row_parts.append(str(ne_data.nsl4_list[i]))
            
            # 写入邻接网格ID
            for j in range(ne_data.nsl1_list[i]):
                row_parts.append(str(ne_data.isl1_list[i][j+1]))
            for j in range(ne_data.nsl2_list[i]):
                row_parts.append(str(ne_data.isl2_list[i][j+1]))
            for j in range(ne_data.nsl3_list[i]):
                row_parts.append(str(ne_data.isl3_list[i][j+1]))
            for j in range(ne_data.nsl4_list[i]):
                row_parts.append(str(ne_data.isl4_list[i][j+1]))
            
            # 写入坐标和高程信息
            row_parts.append(f"{ne_data.xe_list[i]:.14g}")
            row_parts.append(f"{ne_data.ye_list[i]:.14g}")
            row_parts.append(f"{ne_data.ze_list[i]:.14g}")
            row_parts.append(f"{ne_data.under_suf_list[i]}")
            
            f.write(', '.join(row_parts) + '\n')

def write_ns(ns_path: str, ns_data: NsData) -> None:
    """
    将NsData对象写入NS文件
    
    Args:
        ns_path: 输出NS文件路径
        ns_data: NsData对象
    """
    with open(ns_path, 'w', encoding='utf-8', newline='') as f:
        # 从1开始遍历，跳过初始占位元素
        for i in range(1, len(ns_data.edge_id_list)):
            # 写入边ID
            row_parts = [str(ns_data.edge_id_list[i])]
            
            # 写入边的方向和邻接网格ID
            for j in range(len(ns_data.ise_list[i])):
                row_parts.append(str(ns_data.ise_list[i][j]))
            
            # 写入距离和坐标信息
            row_parts.append(f"{ns_data.dis_list[i]:.14g}")
            row_parts.append(f"{ns_data.x_side_list[i]:.14g}")
            row_parts.append(f"{ns_data.y_side_list[i]:.14g}")
            row_parts.append(f"{ns_data.z_side_list[i]:.14g}")
            row_parts.append(f"{ns_data.s_type_list[i]}")
            
            f.write(', '.join(row_parts) + '\n')

def get_ne(ne_path: str) -> "NeData":
    # 初始化列表（含占位符 0）
    grid_id_list: List[int] = [0]
    nsl1_list: List[int] = [0]
    nsl2_list: List[int] = [0]
    nsl3_list: List[int] = [0]
    nsl4_list: List[int] = [0]
    isl1_list: List[List[int]] = [[0]*10]
    isl2_list: List[List[int]] = [[0]*10]
    isl3_list: List[List[int]] = [[0]*10]
    isl4_list: List[List[int]] = [[0]*10]
    xe_list: List[float] = [0.0]
    ye_list: List[float] = [0.0]
    ze_list: List[float] = [0.0]
    under_suf_list: List[int] = [0]

    ne_path = str(ne_path)
    logger.info(f"Loading NE file: {ne_path}")

    try:
        with open(ne_path, 'r', encoding='utf-8-sig') as f:
            for line_idx, raw_line in enumerate(f):
                original_line = raw_line
                try:
                    stripped_line = raw_line.strip(', ')
                    if not stripped_line:
                        continue  # 跳过空行

                    # === 关键修复：强制使用空白符分割，不再检测逗号 ===
                    # 使用 ,\s+ 作为分隔符，确保即使存在逗号也能正确分割
                    row_data = [item for item in re.split(r',\s*', stripped_line) if item]
                    
                    logger.debug(f"[NE Line {line_idx+1}] Parsed {len(row_data)} fields: {row_data[:5]}{'...' if len(row_data) > 5 else ''}")

                    if len(row_data) < 5:
                        logger.warning(f"Skipping line {line_idx+1} in {ne_path}: fewer than 5 fields. Raw: {original_line.strip()}")
                        continue

                    # 解析前5个整数
                    try:
                        grid_id = int(row_data[0])
                        nsl1 = int(row_data[1])
                        nsl2 = int(row_data[2])
                        nsl3 = int(row_data[3])
                        nsl4 = int(row_data[4])
                    except ValueError as ve:
                        logger.error(f"Failed to parse integer at line {line_idx+1}. Data: {row_data[:5]}")
                        raise ValueError(f"Invalid integer in first 5 fields at line {line_idx+1}") from ve

                    # 计算所需最小字段数：5 (header) + nsl1+nsl2+nsl3+nsl4 (neighbors) + 4 (coords)
                    min_required = 5 + nsl1 + nsl2 + nsl3 + nsl4 + 4
                    if len(row_data) < min_required:
                        logger.error(f"Line {line_idx+1}: expected at least {min_required} fields, got {len(row_data)}. Data: {row_data}")
                        raise ValueError(f"Insufficient data at line {line_idx+1}")

                    # 构建邻居列表（长度至少为10，按需扩展）
                    def build_isl(nsl_val: int, start_idx: int) -> List[int]:
                        isl = [0] * max(10, nsl_val + 1)
                        for i in range(nsl_val):
                            isl[i + 1] = int(row_data[start_idx + i])
                        return isl

                    isl1 = build_isl(nsl1, 5)
                    isl2 = build_isl(nsl2, 5 + nsl1)
                    isl3 = build_isl(nsl3, 5 + nsl1 + nsl2)
                    isl4 = build_isl(nsl4, 5 + nsl1 + nsl2 + nsl3)

                    # 提取最后4个字段（坐标 + under_suf）
                    xe = float(row_data[-4])
                    ye = float(row_data[-3])
                    ze = float(row_data[-2])
                    under_suf = int(float(row_data[-1]))  # 兼容 "3.0" -> 3

                    # 添加到主列表
                    grid_id_list.append(grid_id)
                    nsl1_list.append(nsl1)
                    nsl2_list.append(nsl2)
                    nsl3_list.append(nsl3)
                    nsl4_list.append(nsl4)
                    isl1_list.append(isl1)
                    isl2_list.append(isl2)
                    isl3_list.append(isl3)
                    isl4_list.append(isl4)
                    xe_list.append(xe)
                    ye_list.append(ye)
                    ze_list.append(ze)
                    under_suf_list.append(under_suf)

                except (ValueError, IndexError) as e:
                    logger.error(f"Parsing error in NE file {ne_path} at line {line_idx+1}: {e}. Original line: {original_line.strip()}")
                    raise RuntimeError(f"Failed to parse NE file at line {line_idx+1}") from e

        ne_data = NeData(
            grid_id_list, nsl1_list, nsl2_list, nsl3_list, nsl4_list,
            isl1_list, isl2_list, isl3_list, isl4_list,
            xe_list, ye_list, ze_list, under_suf_list
        )
        return ne_data

    except Exception as e:
        logger.error(f"Failed to load NE file '{ne_path}': {e}")
        raise

def get_ns(ns_path: str) -> NsData:
    edge_id_list = [0]
    ise_list = [[0,0,0,0,0]]
    dis_list = [0.0]
    x_side_list = [0.0]
    y_side_list = [0.0]
    z_side_list = [0.0]
    s_type_list = [0]
    
    # Convert Path to string if needed
    ns_path = str(ns_path)
    logger.info(f"Loading NS file: {ns_path}")
    
    try:
        with open(ns_path,'r',encoding='utf-8') as f:
            for line_num, rowdata in enumerate(f, 1):
                rowdata = rowdata.strip()
                if not rowdata:  # Skip empty lines
                    continue
                # 使用正则分割处理多个', '，与get_ne保持一致
                rowdata = re.split(r',\s*', rowdata)
                # 清理空字符串
                rowdata = [item.strip() for item in rowdata if item.strip()]
                
                try:
                    edge_id_list.append(int(float(rowdata[0])))
                    ise_row = [
                        int(rowdata[1]),
                        int(rowdata[2]),
                        int(rowdata[3]),
                        int(rowdata[4]),
                        int(rowdata[5])
                    ]
                except (ValueError, IndexError) as e:
                    raise ValueError(f"Error parsing edge data at line {line_num}: {rowdata}. Expected at least 6 numeric values. Error: {e}")
                    
                ise_list.append(ise_row)
                try:
                    dis_list.append(float(rowdata[6]))
                    x_side_list.append(float(rowdata[7]))
                    y_side_list.append(float(rowdata[8]))
                    z_side_list.append(float(rowdata[9]))
                    s_type_list.append(float(rowdata[10]))
                except (ValueError, IndexError) as e:
                    raise ValueError(f"Error parsing side data at line {line_num}: {rowdata}. Error: {e}")
        
        ns_data = NsData(
            edge_id_list,
            ise_list,
            dis_list,
            x_side_list,
            y_side_list,
            z_side_list,
            s_type_list
        )
        return ns_data
    except Exception as e:
        logger.error(f"Failed to load NS file: {e}")
        raise e

# ==================== 几何计算类函数 ====================

def is_point_in_polygon(x: float, y: float, polygon_coords: list) -> bool:
    """
    使用射线法判断点是否在多边形内部
    
    Args:
        x: 点的x坐标
        y: 点的y坐标
        polygon_coords: 多边形坐标列表，格式为 [[x1, y1], [x2, y2], ...]
        
    Returns:
        bool: True表示点在多边形内部，False表示在外部
    """
    if len(polygon_coords) < 3:
        return False
    
    n = len(polygon_coords)
    inside = False
    
    p1x, p1y = polygon_coords[0]
    for i in range(1, n + 1):
        p2x, p2y = polygon_coords[i % n]
        
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    
    return inside

def is_point_intersects_with_feature(x: float, y: float, feature_json: dict, ne_data: NeData = None) -> bool:
    """
    判断点是否与GeoJSON feature或FeatureCollection相交
    
    Args:
        x: 点的x坐标
        y: 点的y坐标
        feature_json: GeoJSON格式的地理要素（Feature或FeatureCollection）
        ne_data: 网格数据，用于动态计算缓冲区距离
        
    Returns:
        bool: True表示相交，False表示不相交
    """
    if not feature_json:
        return False
    
    # 检查是否是FeatureCollection
    if feature_json.get('type') == 'FeatureCollection':
        features = feature_json.get('features', [])
        # 只要与任何一个feature相交就返回True
        for feature in features:
            if is_point_intersects_with_feature(x, y, feature, ne_data):
                return True
        return False
    
    # 处理单个Feature
    if 'geometry' not in feature_json:
        return False
    
    
    geometry = feature_json['geometry']
    geom_type = geometry.get('type', '').lower()
    coordinates = geometry.get('coordinates', [])
    
    if geom_type == 'polygon':
        # 对于Polygon，coordinates是 [外环, 内环1, 内环2, ...]
        if not coordinates:
            return False
        
        # 检查是否在外环内
        exterior_ring = coordinates[0]
        if not is_point_in_polygon(x, y, exterior_ring):
            return False
        
        # 检查是否在任何内环（洞）内，如果在洞内则不相交
        for i in range(1, len(coordinates)):
            interior_ring = coordinates[i]
            if is_point_in_polygon(x, y, interior_ring):
                return False
        
        return True
    
    elif geom_type == 'multipolygon':
        # 对于MultiPolygon，coordinates是 [polygon1, polygon2, ...]
        for polygon_coords in coordinates:
            if not polygon_coords:
                continue
            
            # 检查是否在外环内
            exterior_ring = polygon_coords[0]
            if not is_point_in_polygon(x, y, exterior_ring):
                continue
            
            # 检查是否在任何内环（洞）内
            in_hole = False
            for i in range(1, len(polygon_coords)):
                interior_ring = polygon_coords[i]
                if is_point_in_polygon(x, y, interior_ring):
                    in_hole = True
                    break
            
            if not in_hole:
                return True
        
        return False
    
    elif geom_type == 'point':
        # 对于Point，检查是否是同一个点（考虑浮点数精度）
        if len(coordinates) >= 2:
            return abs(coordinates[0] - x) < 1e-9 and abs(coordinates[1] - y) < 1e-9
        return False
    
    elif geom_type == 'linestring':
        # 对于LineString，动态计算缓冲区距离
        if len(coordinates) < 2:
            return False
        
        # 动态计算缓冲区距离
        buffer_distance = calculate_dynamic_buffer_distance(x, y, ne_data)
        
        for i in range(len(coordinates) - 1):
            x1, y1 = coordinates[i]
            x2, y2 = coordinates[i + 1]
            
            # 计算点到线段的最短距离
            distance = point_to_line_segment_distance(x, y, x1, y1, x2, y2)
            
            # 如果距离小于动态计算的缓冲区距离，认为相交
            if distance <= buffer_distance:
                return True
        
        return False
    
    # 其他几何类型暂不支持
    return False

def calculate_dynamic_buffer_distance(x: float, y: float, ne_data: NeData) -> float:
    """
    动态计算缓冲区距离，基于当前点与最近邻网格点的距离
    
    Args:
        x: 当前点的x坐标
        y: 当前点的y坐标
        ne_data: 网格数据
        
    Returns:
        float: 动态计算的缓冲区距离
    """
    if not ne_data or len(ne_data.xe_list) < 2:
        return 50.0  # 默认值
    
    min_distance = float('inf')
    
    # 找到最近的邻居网格点
    for i in range(len(ne_data.xe_list)):
        grid_x = ne_data.xe_list[i]
        grid_y = ne_data.ye_list[i]
        
        # 跳过当前点本身
        if abs(grid_x - x) < 1e-6 and abs(grid_y - y) < 1e-6:
            continue
            
        distance = math.sqrt((x - grid_x)**2 + (y - grid_y)**2)
        if distance < min_distance:
            min_distance = distance
    
    # 使用最近邻距离的一半作为缓冲区距离
    # 这样可以确保不会过度扩大影响范围
    return min_distance / 2.0 if min_distance != float('inf') else 50.0

def point_to_line_segment_distance(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
    """
    计算点到线段的最短距离
    
    Args:
        px, py: 点坐标
        x1, y1: 线段起点
        x2, y2: 线段终点
        
    Returns:
        float: 点到线段的最短距离
    """
    # 线段向量
    dx = x2 - x1
    dy = y2 - y1
    
    # 如果线段退化为点
    if dx == 0 and dy == 0:
        return math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
    
    # 计算点在线段上的投影参数t (0 <= t <= 1表示投影在线段上)
    t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    
    # 计算投影点坐标
    proj_x = x1 + t * dx
    proj_y = y1 + t * dy
    
    # 计算点到投影点的距离
    return math.sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)

def do_line_segments_intersect(x1: float, y1: float, x2: float, y2: float, 
                              x3: float, y3: float, x4: float, y4: float) -> bool:
    """
    检查两条线段是否相交
    
    Args:
        x1, y1: 第一条线段的起点
        x2, y2: 第一条线段的终点
        x3, y3: 第二条线段的起点
        x4, y4: 第二条线段的终点
        
    Returns:
        bool: True表示线段相交，False表示不相交
    """
    # 计算方向
    def direction(x1, y1, x2, y2, x3, y3):
        return (x3 - x1) * (y2 - y1) - (x2 - x1) * (y3 - y1)
    
    # 检查点是否在线段上
    def on_segment(x1, y1, x2, y2, x3, y3):
        return (min(x1, x2) <= x3 <= max(x1, x2) and 
                min(y1, y2) <= y3 <= max(y1, y2))
    
    # 计算方向值
    d1 = direction(x3, y3, x4, y4, x1, y1)
    d2 = direction(x3, y3, x4, y4, x2, y2)
    d3 = direction(x1, y1, x2, y2, x3, y3)
    d4 = direction(x1, y1, x2, y2, x4, y4)
    
    # 线段相交的一般情况
    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    
    # 处理共线或端点在另一条线段上的情况
    if d1 == 0 and on_segment(x3, y3, x4, y4, x1, y1):
        return True
    if d2 == 0 and on_segment(x3, y3, x4, y4, x2, y2):
        return True
    if d3 == 0 and on_segment(x1, y1, x2, y2, x3, y3):
        return True
    if d4 == 0 and on_segment(x1, y1, x2, y2, x4, y4):
        return True
    
    return False

# ==================== 坐标转换类函数 ====================
def get_transformer(from_crs: str, to_crs: str) -> Transformer:
    """获取缓存的坐标转换器"""
    key = (from_crs, to_crs)
    if key not in _transformer_cache:
        _transformer_cache[key] = Transformer.from_crs(from_crs, to_crs, always_xy=True)
    return _transformer_cache[key]

def transform_coordinates(    
    lon: float, 
    lat: float, 
    from_crs: str, 
    to_crs: str
    ) -> tuple[float, float]:
    """
    快速坐标转换（使用缓存的转换器）
    
    Args:
        lon: 经度 (EPSG:4326)
        lat: 纬度 (EPSG:4326)
        
    Returns:
        tuple[float, float]: 转换后的坐标 (x, y) in EPSG:2326
    """
    transformer = get_transformer(from_crs, to_crs)
    x, y = transformer.transform(lon, lat)
    return x, y

def transform_point_list(    
    point_list: list, 
    from_crs: str, 
    to_crs: str
    ) -> list:
    """
    快速坐标点列表转换（使用缓存的转换器）
    
    Args:
        point_list: 坐标点列表 [lon, lat] in EPSG:4326
        
    Returns:
        list: 转换后的坐标点列表 [x, y] in EPSG:2326
    """
    if not isinstance(point_list, list) or len(point_list) < 2:
        return point_list
    
    lon, lat = point_list[0], point_list[1]
    x, y = transform_coordinates(lon, lat, from_crs, to_crs)

    return [x, y]

def transform_feature(    
    feature: dict, 
    from_crs: str, 
    to_crs: str
    ) -> dict:
    """
    将GeoJSON feature从EPSG:4326转换为EPSG:2326
    
    Args:
        feature: GeoJSON格式的地理要素（Feature或FeatureCollection）
        
    Returns:
        dict: 转换后的GeoJSON feature
    """
    if not feature:
        return feature
        
    def transform_coords_recursive(coords):
        if isinstance(coords[0], (int, float)):
            # 单个坐标点
            x, y = transform_coordinates(coords[0], coords[1], from_crs, to_crs)
            return [x, y]
        return [transform_coords_recursive(c) for c in coords]
    
    feature = copy.deepcopy(feature)
    
    if feature.get('type') == 'FeatureCollection':
        for f in feature.get('features', []):
            if 'geometry' in f:
                f['geometry']['coordinates'] = transform_coords_recursive(f['geometry']['coordinates'])
        return feature
    
    if 'geometry' in feature:
        feature['geometry']['coordinates'] = transform_coords_recursive(feature['geometry']['coordinates'])
    
    return feature

# ==================== 网格定位类函数 ====================

def find_grid_for_point(x: float, y: float, ne_data: NeData) -> int | None:
    """
    根据坐标点找到对应的网格ID（使用最近邻算法）
    
    Args:
        x: 点的x坐标
        y: 点的y坐标
        ne_data: 网格数据
        
    Returns:
        int | None: 对应的网格ID，如果没找到则返回None
    """
    
    min_distance = float('inf')
    nearest_grid_id = None
    
    # 遍历所有网格，找到距离最近的网格中心点
    for i in range(len(ne_data.xe_list)):
        grid_x = ne_data.xe_list[i]
        grid_y = ne_data.ye_list[i]
        
        # 计算欧几里得距离
        distance = math.sqrt((x - grid_x)**2 + (y - grid_y)**2)
        
        if distance < min_distance:
            min_distance = distance
            nearest_grid_id = ne_data.grid_id_list[i]
    
    return nearest_grid_id

def find_grid_for_feature_point(feature_json: dict, ne_data: NeData, grid_result: np.ndarray = None) -> list[int]:
    """
    根据GeoJSON格式的点要素找到对应的网格ID列表
    
    Args:
        feature_json: GeoJSON格式的地理要素（Feature或FeatureCollection）
        ne_data: 网格数据
        grid_result: 网格数据数组，每行包含 [网格ID, 中心x坐标, 中心y坐标, 半边长]
        
    Returns:
        list[int]: 与点要素对应的网格ID列表
    """
    if not feature_json:
        return []
    
    grid_ids = []
    
    # 检查是否是FeatureCollection
    if feature_json.get('type') == 'FeatureCollection':
        features = feature_json.get('features', [])
        
        # 处理FeatureCollection中的每个Feature
        for feature in features:
            grid_ids.extend(find_grid_for_feature_point(feature, ne_data, grid_result))
            
        # 去重
        return list(set(grid_ids))
    
    # 处理单个Feature
    if 'geometry' not in feature_json:
        return []
    
    geometry = feature_json['geometry']
    geom_type = geometry.get('type', '').lower()
    coordinates = geometry.get('coordinates', [])
    
    if geom_type == 'point':
        # 对于Point，找到对应的网格ID
        if len(coordinates) >= 2:
            x, y = coordinates[0], coordinates[1]
            if grid_result is not None:
                # 使用grid_result查找点所在的网格
                grid_id = find_grid_for_point_using_grid_result(x, y, grid_result)
                if grid_id is not None:
                    grid_ids.append(grid_id)
                    logger.info(f"点坐标 ({x}, {y}) 使用grid_result对应网格ID: {grid_id}")
                else:
                    # 如果使用grid_result找不到，回退到使用ne_data
                    grid_id = find_grid_for_point(x, y, ne_data)
                    if grid_id is not None:
                        grid_ids.append(grid_id)
                        logger.info(f"点坐标 ({x}, {y}) 回退使用ne_data对应网格ID: {grid_id}")
            else:
                # 如果没有提供grid_result，使用ne_data
                grid_id = find_grid_for_point(x, y, ne_data)
                if grid_id is not None:
                    grid_ids.append(grid_id)
                    logger.info(f"点坐标 ({x}, {y}) 对应网格ID: {grid_id}")
    
    elif geom_type == 'multipoint':
        # 对于MultiPoint，处理每个点
        for point_coords in coordinates:
            if len(point_coords) >= 2:
                x, y = point_coords[0], point_coords[1]
                if grid_result is not None:
                    # 使用grid_result查找点所在的网格
                    grid_id = find_grid_for_point_using_grid_result(x, y, grid_result)
                    if grid_id is not None:
                        grid_ids.append(grid_id)
                        logger.info(f"多点坐标 ({x}, {y}) 使用grid_result对应网格ID: {grid_id}")
                    else:
                        # 如果使用grid_result找不到，回退到使用ne_data
                        grid_id = find_grid_for_point(x, y, ne_data)
                        if grid_id is not None:
                            grid_ids.append(grid_id)
                            logger.info(f"多点坐标 ({x}, {y}) 回退使用ne_data对应网格ID: {grid_id}")
                else:
                    # 如果没有提供grid_result，使用ne_data
                    grid_id = find_grid_for_point(x, y, ne_data)
                    if grid_id is not None:
                        grid_ids.append(grid_id)
                        logger.info(f"多点坐标 ({x}, {y}) 对应网格ID: {grid_id}")
    
    return grid_ids

def find_grid_for_point_using_grid_result(x: float, y: float, grid_result: np.ndarray) -> int | None:
    """
    使用grid_result查找点所在的网格ID
    
    Args:
        x: 点的x坐标
        y: 点的y坐标
        grid_result: 网格数据数组，每行包含 [网格ID, 中心x坐标, 中心y坐标, 半边长]
        
    Returns:
        int | None: 对应的网格ID，如果没找到则返回None
    """
    if grid_result is None or len(grid_result) == 0:
        return None
    
    for grid_row in grid_result:
        if len(grid_row) < 4:
            continue
        
        grid_id = int(grid_row[0])
        grid_center_x = float(grid_row[1])
        grid_center_y = float(grid_row[2])
        half_size = float(grid_row[3])
        
        # 计算网格的边界
        min_x = grid_center_x - half_size
        max_x = grid_center_x + half_size
        min_y = grid_center_y - half_size
        max_y = grid_center_y + half_size
        
        # 检查点是否在网格内
        if min_x <= x <= max_x and min_y <= y <= max_y:
            return grid_id
    
    return None

# ==================== 辅助处理类函数 ====================

def get_grids_intersecting_with_line(feature_json: dict, grid_result: np.ndarray) -> list:
    """
    获取与线要素相交的网格ID列表
    
    Args:
        feature_json: GeoJSON格式的地理要素（已转换为EPSG:2326），可以是Feature或FeatureCollection
        grid_result: 网格数据数组，每行包含 [网格ID, 中心x坐标, 中心y坐标, 半边长]
        
    Returns:
        list: 与线要素相交的网格ID列表
    """
    if not feature_json:
        return []
    
    # 检查是否是FeatureCollection
    if feature_json.get('type') == 'FeatureCollection':
        print("处理FeatureCollection中的多个Feature")
        features = feature_json.get('features', [])
        all_intersecting_grid_ids = []
        
        # 处理FeatureCollection中的每个Feature
        for feature in features:
            intersecting_grid_ids = get_grids_intersecting_with_line(feature, grid_result)
            all_intersecting_grid_ids.extend(intersecting_grid_ids)
        
        # 去重
        return list(set(all_intersecting_grid_ids))
    
    # 处理单个Feature
    if 'geometry' not in feature_json:
        return []
    
    geometry = feature_json['geometry']
    geom_type = geometry.get('type', '').lower()
    coordinates = geometry.get('coordinates', [])
    
    # 只处理LineString或MultiLineString几何类型
    if geom_type != 'linestring' and geom_type != 'multilinestring':
        logger.warning(f"几何类型 {geom_type} 不是线要素，无法计算相交的网格")
        return []
    
    intersecting_grid_ids = []
    
    # 处理所有线段
    line_segments = []
    if geom_type == 'linestring':
        # 单线，将所有相邻点对构成线段
        print(len(coordinates)-1)
        for i in range(len(coordinates) - 1):
            line_segments.append((coordinates[i], coordinates[i + 1]))
    elif geom_type == 'multilinestring':
        # 多线，每条线都需要处理
        for line in coordinates:
            for i in range(len(line) - 1):
                line_segments.append((line[i], line[i + 1]))
    
    # 遍历所有网格，检查是否与任何线段相交
    for grid_row in grid_result:
        if len(grid_row) < 4:
            continue
        
        grid_id = int(grid_row[0])
        grid_center_x = float(grid_row[1])
        grid_center_y = float(grid_row[2])
        half_size = float(grid_row[3])
        
        # 计算网格的四个顶点
        min_x = grid_center_x - half_size
        max_x = grid_center_x + half_size
        min_y = grid_center_y - half_size
        max_y = grid_center_y + half_size
        
        # 网格的四条边
        grid_edges = [
            ((min_x, min_y), (max_x, min_y)),  # 下边
            ((max_x, min_y), (max_x, max_y)),  # 右边
            ((max_x, max_y), (min_x, max_y)),  # 上边
            ((min_x, max_y), (min_x, min_y))   # 左边
        ]
        
        # 检查线段是否与网格相交
        for line_segment in line_segments:
            line_p1, line_p2 = line_segment
            line_x1, line_y1 = line_p1
            line_x2, line_y2 = line_p2
            
            # 检查线段是否完全在网格外部
            if (max(line_x1, line_x2) < min_x or
                min(line_x1, line_x2) > max_x or
                max(line_y1, line_y2) < min_y or
                min(line_y1, line_y2) > max_y):
                continue
            
            # 检查线段端点是否在网格内部
            if (min_x <= line_x1 <= max_x and min_y <= line_y1 <= max_y) or \
               (min_x <= line_x2 <= max_x and min_y <= line_y2 <= max_y):
                intersecting_grid_ids.append(grid_id)
                break
            
            # 检查线段是否与网格边界相交
            for grid_edge in grid_edges:
                grid_p1, grid_p2 = grid_edge
                grid_x1, grid_y1 = grid_p1
                grid_x2, grid_y2 = grid_p2
                
                if do_line_segments_intersect(
                    line_x1, line_y1, line_x2, line_y2,
                    grid_x1, grid_y1, grid_x2, grid_y2
                ):
                    intersecting_grid_ids.append(grid_id)
                    break
            else:
                # 如果与网格的所有边都不相交，继续检查下一个线段
                continue
            
            # 如果已找到相交，跳出线段循环
            break
    
    return intersecting_grid_ids

def _get_feature_from_node(node_key: str) -> dict:
    """
    根据node_key加载矢量节点的GeoJSON数据
    
    Args:
        node_key: 矢量节点的key
        
    Returns:
        dict: 加载的GeoJSON数据
    """
    if not node_key:
        return {}
    
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_dir = Path.cwd() / 'resource' / rel_path
    
    if not resource_dir.exists():
        logger.warning(f"Vector resource directory not found: {resource_dir} for key {node_key}")
        return {}
        
    # 查找目录下的.geojson文件
    geojson_files = list(resource_dir.glob('*.geojson'))
    
    if not geojson_files:
        logger.warning(f"No .geojson file found in {resource_dir}")
        return {}
        
    # 加载第一个找到的geojson文件
    geojson_path = geojson_files[0]
    try:
        with open(geojson_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        logger.info(f"Loaded feature from {geojson_path}")
        return data
    except Exception as e:
        logger.error(f"Failed to load geojson from {geojson_path}: {e}")
        return {}

def _get_crs_from_node_key(node_key: str) -> str:
    """
    Get CRS information from node_key
    
    Args:
        node_key: Node key, such as '.point'
        
    Returns:
        str: Coordinate Reference System, such as 'EPSG:4326'
    """
    if not node_key:
        return "EPSG:4326"

    # Convert node_key to path
    # Example: .HK.evaluation.fishpondline -> HK/evaluation/fishpondline
    rel_path = node_key.strip('.').replace('.', os.sep)
    
    # Build meta.json path
    meta_path = Path.cwd() / "resource" / rel_path / "meta.json"
    
    if not meta_path.exists():
        logger.warning(f"meta.json file not found: {meta_path}")
        return "EPSG:4326"  # Default to 4326
    
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta_data = json.load(f)
        
        epsg_code = meta_data.get('epsg', 4326)
        if isinstance(epsg_code, int):
            return f"EPSG:{epsg_code}"
        else:
            return str(epsg_code)
    except Exception as e:
        logger.error(f"Failed to read meta.json file: {e}")
        return "EPSG:4326"

def _get_crs_from_schema_node_key(schema_node_key: str) -> str:
    """
    Get CRS information from schema_node_key
    
    Args:
        schema_node_key: Schema node key, such as '.schema'
        
    Returns:
        str: Coordinate Reference System, such as 'EPSG:2326'
    """
    if not schema_node_key:
        return "EPSG:2326"

    # Convert schema_node_key to path
    # Example: .HK.schema -> resource/HK/schema/schema.json
    rel_path = schema_node_key.strip('.').replace('.', os.sep)
    
    # Build schema.json path
    schema_path = Path.cwd() / "resource" / rel_path / "schema.json"
    
    if not schema_path.exists():
        logger.warning(f"schema.json file not found: {schema_path}")
        return "EPSG:4326"  # Default to 4326
    
    try:
        with open(schema_path, 'r', encoding='utf-8') as f:
            schema_data = json.load(f)
        
        epsg_code = schema_data.get('epsg', 4326)
        if isinstance(epsg_code, int):
            return f"EPSG:{epsg_code}"
        else:
            return str(epsg_code)
    except Exception as e:
        logger.error(f"Failed to read schema.json file: {e}")
        return "EPSG:2326"  # Default to 2326
# ==================== 操作应用类函数 ====================

def apply_vector_modification(params: dict, model_data: dict) -> dict:
    """
    应用添加围堰操作到模型数据（基于vector参数）
    
    Args:
        vector_params: 矢量参数，包含DEM和LUM信息
        model_data: 模型数据字典，包含ne和ns数据
        
    Returns:
        dict: 更新后的模型数据
    """
    
    logger.info("开始应用基围（基于vector参数）")
    
    vector_list = params.get('vector', [])
    assembly_params = params.get('assembly', {})

    if not isinstance(vector_list, list):
        logger.warning("vector参数不是一个列表，尝试将其包装为列表")
        vector_list = [vector_list]

    ne_data: NeData = model_data.get('ne', {})
    ns_data: NsData = model_data.get('ns', {})

    for vector_params in vector_list:
        if not isinstance(vector_params, dict):
            logger.warning(f"跳过非字典类型的vector参数: {vector_params}")
            continue

        # 从vector参数中提取DEM和LUM信息
        dem_params = vector_params.get('dem', {})
        lum_params = vector_params.get('lum', {})
        
        dem_type = dem_params.get('type')
        dem_value = dem_params.get('value')
        lum_type = lum_params.get('type')
        lum_value = lum_params.get('value')

        node_key = vector_params.get('node_key')
        schema_node_key = assembly_params.get('schema_node_key')
        feature = _get_feature_from_node(node_key)

        from_crs = _get_crs_from_node_key(node_key)
        to_crs = _get_crs_from_schema_node_key(schema_node_key)
        feature_json = transform_feature(feature, from_crs, to_crs)


        
        if dem_type is not None and dem_value is not None:
            if dem_type == 'add':  # 加法
                for index in range(len(ne_data.xe_list)):
                    x = ne_data.xe_list[index]
                    y = ne_data.ye_list[index]
                    
                    # 判断当前网格点是否与feature相交
                    if is_point_intersects_with_feature(x, y, feature_json):
                        ne_data.ze_list[index] += dem_value
                        # logger.info(f"网格中心点 ({x}, {y}) 应用了加法DEM修改: +{dem_value}")
            
            elif dem_type == 'set':  # 设置指定高程
                for index in range(len(ne_data.xe_list)):
                    x = ne_data.xe_list[index]
                    y = ne_data.ye_list[index]
                    
                    if is_point_intersects_with_feature(x, y, feature_json):
                        ne_data.ze_list[index] = dem_value
                        # logger.info(f"网格中心点 ({x}, {y}) 应用了绝对值DEM修改: {dem_value}")
            
            elif dem_type == 'subtract':  # 减法
                for index in range(len(ne_data.xe_list)):
                    x = ne_data.xe_list[index]
                    y = ne_data.ye_list[index]
                    
                    if is_point_intersects_with_feature(x, y, feature_json):
                        ne_data.ze_list[index] -= dem_value
                        # logger.info(f"网格中心点 ({x}, {y}) 应用了减法DEM修改: -{dem_value}")

            
            else:  # 默认情况 - 加法模式
                for index in range(len(ne_data.xe_list)):
                    x = ne_data.xe_list[index]
                    y = ne_data.ye_list[index]
                    
                    # 判断当前网格点是否与feature相交
                    if is_point_intersects_with_feature(x, y, feature_json):
                        ne_data.ze_list[index] += dem_value if dem_value is not None else 0
                        # logger.info(f"网格中心点 ({x}, {y}) 应用了默认DEM修改: +{dem_value or 0}")

        if dem_type is not None and dem_type == 'max':  # 设置为最大高程值
                # 首先找到vector范围内的最大DEM值
                max_dem_value = float('-inf')
                for index in range(len(ne_data.xe_list)):
                    x = ne_data.xe_list[index]
                    y = ne_data.ye_list[index]
                    
                    if is_point_intersects_with_feature(x, y, feature_json):
                        if ne_data.ze_list[index] > max_dem_value:
                            max_dem_value = ne_data.ze_list[index]
                
                # 如果找到了有效的最大值，则将vector范围内的所有值设置为该最大值
                if max_dem_value != float('-inf'):
                    for index in range(len(ne_data.xe_list)):
                        x = ne_data.xe_list[index]
                        y = ne_data.ye_list[index]
                        
                        if is_point_intersects_with_feature(x, y, feature_json):
                            ne_data.ze_list[index] = max_dem_value
        
        # 根据LUM参数修改土地利用类型
        if lum_type == 'set' and lum_value is not None:
            for index in range(len(ne_data.xe_list)):
                x = ne_data.xe_list[index]
                y = ne_data.ye_list[index]
                
                # 判断当前网格点是否与feature相交
                if is_point_intersects_with_feature(x, y, feature_json):
                    ne_data.under_suf_list[index] = lum_value
                    # logger.info(f"网格中心点 ({x}, {y}) 应用了LUM修改: {lum_value}")
        
        # 对ns数据也做相应处理
        if dem_type is not None and dem_value is not None:
            for index in range(len(ns_data.x_side_list)):
                x = ns_data.x_side_list[index]
                y = ns_data.y_side_list[index]

                # 判断当前网格点是否与feature相交
                if is_point_intersects_with_feature(x, y, feature_json):
                    ns_data.z_side_list[index] += dem_value if dem_value is not None else 0
                    # logger.info(f"边中心点 ({x}, {y}) 应用了DEM修改: +{dem_value or 0}")

        if lum_type is not None and lum_value is not None:
            for index in range(len(ns_data.x_side_list)):
                x = ns_data.x_side_list[index]
                y = ns_data.y_side_list[index]

                # 判断当前网格点是否与feature相交
                if is_point_intersects_with_feature(x, y, feature_json):
                    ns_data.s_type_list[index] = lum_value
                    # logger.info(f"边中心点 ({x}, {y}) 应用了LUM修改: {lum_value}")

    model_data['ne'] = ne_data
    model_data['ns'] = ns_data
    
    return model_data
