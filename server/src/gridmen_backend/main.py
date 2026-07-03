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
from .web import PublicBasePathMiddleware, mount_static_frontend
from pynoodle import NOODLE_INIT, NOODLE_TERMINATE
from pynoodle.endpoints import router as noodle_router

logging.basicConfig(level=logging.INFO)

@asynccontextmanager
async def lifespan(app: FastAPI):
    NOODLE_INIT()
    yield
    NOODLE_TERMINATE()

def include_noodle_routes(app: FastAPI) -> None:
    app.include_router(noodle_router, prefix='/noodle', tags=['noodle'])

    root_node_route = next(
        (
            route
            for route in noodle_router.routes
            if getattr(route, 'path', None) == '/node/' and 'GET' in getattr(route, 'methods', set())
        ),
        None,
    )
    if root_node_route is not None:
        # Existing frontend builds call the root node endpoint without the trailing slash.
        app.add_api_route(
            '/noodle/node',
            root_node_route.endpoint,
            methods=['GET'],
            response_model=getattr(root_node_route, 'response_model', None),
            tags=['noodle'],
            include_in_schema=False,
        )

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
    app.add_middleware(
        PublicBasePathMiddleware,
        public_base_path=settings.WEB_PUBLIC_BASE_PATH,
    )
    app.include_router(api_router)
    include_noodle_routes(app)
    mount_static_frontend(app, settings.WEB_STATIC_DIR)
    return app

app = create_app()
