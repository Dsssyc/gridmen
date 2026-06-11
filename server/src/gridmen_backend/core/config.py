import os
from pathlib import Path
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings

ROOT_DIR = Path(__file__).parent.parent.parent.parent

class Settings(BaseSettings):
    # Server configuration
    DEBUG: bool = True
    SERVER_PORT: int = 8000
    APP_VERSION: str = '1.0.0'
    APP_NAME: str = 'Gridmen Calculation Backend'
    
    # Proxy configuration
    HTTP_PROXY: str = ''
    HTTPS_PROXY: str = ''
    
    # Noodle configuration
    ROOT_DIR: Path = ROOT_DIR
    SQLITE_PATH: str = str(ROOT_DIR / 'noodle.db')
    MEMORY_TEMP_PATH: str = str(ROOT_DIR / 'temp')
    NOODLE_CONFIG_PATH: str = str(ROOT_DIR / 'noodle.config.yaml')
    
    # Grid schema related constants
    GRID_SCHEMA_DIR: str = 'resource/topo/schemas/'
    
    # Grid-related constants
    GRID_PATCH_META_FILE_NAME: str = 'patch.meta.json'
    GRID_PATCH_TOPOLOGY_FILE_NAME: str = 'patch.topo.arrow'

    # CORS
    CORS_ORIGINS: list[str] = ['*']
    CORS_HEADERS: list[str] = ['*']
    CORS_METHODS: list[str] = ['*']
    CORS_CREDENTIALS: bool = True

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug_mode(cls, value: Any) -> Any:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "prod", "production"}:
                return False
            if normalized in {"debug", "dev", "development"}:
                return True
        return value

    def inject_env(self, keys: list[str]):
        """Inject specific settings into environment variables"""
        for key in keys:
            if value := getattr(self, key, None):
                os.environ[key] = str(value)

    class Config:
        env_file = '.env'
        extra = 'ignore'

settings = Settings()
