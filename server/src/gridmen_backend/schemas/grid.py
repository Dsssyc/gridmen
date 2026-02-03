from pydantic import BaseModel

class GridExportRequest(BaseModel):
    node_key: str
    target_path: str