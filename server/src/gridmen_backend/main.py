import os
import sys
import uvicorn
import logging
from fastapi import FastAPI
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), 'api', 'endpoints')))

from .core import settings
from .api import api_router
from pynoodle import NOODLE_INIT, NOODLE_TERMINATE

logging.basicConfig(level=logging.INFO)

@asynccontextmanager
async def lifespan(app: FastAPI):
    NOODLE_INIT(app)
    yield
    NOODLE_TERMINATE()

def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_methods=settings.CORS_METHODS,
        allow_headers=settings.CORS_HEADERS,
        allow_credentials=settings.CORS_CREDENTIALS,
    )
    app.include_router(api_router)
    return app

app = create_app()
