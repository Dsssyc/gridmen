import c_two as cc
from typing import Any
from pydantic import BaseModel

class UpdateFeatureBody(BaseModel):
    epsg: str
    color: str
    feature_json: dict[str, Any]

# Define ICRM ###########################################################

@cc.icrm(namespace='gridmen', version='1.0.0')
class IVector:
    def get_epsg_code(self) -> str:
        ...
    
    def get_geojson_string(self) -> str:
        ...
    
    def save_feature(self, feature_json: dict[str, Any]) -> dict[str, bool | str]:
        ...

    def save_uploaded_feature(self, file_path: str, file_type: str) -> dict[str, bool | str]:
        ...

    def get_feature(self, target_epsg: str) -> dict[str, Any]:
        ...

    def get_feature_json_computation(self) -> dict[str, Any]:
        ...

    def update_feature(self, update_body: UpdateFeatureBody) -> dict[str, bool | str]:
        ...

    def delete_feature(self) -> dict[str, bool | str]:
        ...