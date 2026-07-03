from pathlib import Path
from typing import Iterable

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from starlette.types import ASGIApp, Receive, Scope, Send


def normalize_public_base_path(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw or raw == "/":
        return "/"
    return f"/{raw.strip('/')}"


class PublicBasePathMiddleware:
    def __init__(self, app: ASGIApp, public_base_path: str | None = None) -> None:
        self.app = app
        normalized = normalize_public_base_path(public_base_path)
        self.prefix = "" if normalized == "/" else normalized

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not self.prefix or scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if path == self.prefix or path.startswith(f"{self.prefix}/"):
            next_scope = dict(scope)
            next_scope["path"] = path[len(self.prefix):] or "/"
            next_scope["root_path"] = f"{scope.get('root_path', '')}{self.prefix}"
            await self.app(next_scope, receive, send)
            return

        await self.app(scope, receive, send)


def _is_reserved_path(path: str, api_prefixes: Iterable[str]) -> bool:
    normalized_path = f"/{path.lstrip('/')}"
    return any(
        normalized_path == prefix or normalized_path.startswith(f"{prefix}/")
        for prefix in api_prefixes
    )


def _resolve_static_file(static_dir: Path, frontend_path: str) -> Path | None:
    relative_path = frontend_path.lstrip("/") or "index.html"
    candidate = (static_dir / relative_path).resolve()

    try:
        candidate.relative_to(static_dir)
    except ValueError:
        return None

    return candidate if candidate.is_file() else None


def mount_static_frontend(
    app: FastAPI,
    static_dir: str | Path,
    api_prefixes: Iterable[str] = ("/api", "/noodle"),
) -> bool:
    static_root = Path(static_dir).resolve()
    index_path = static_root / "index.html"
    if not index_path.is_file():
        return False

    normalized_prefixes = tuple(f"/{prefix.strip('/')}" for prefix in api_prefixes)

    @app.get("/", include_in_schema=False)
    def serve_index() -> FileResponse:
        return FileResponse(index_path)

    @app.get("/{frontend_path:path}", include_in_schema=False)
    def serve_frontend(frontend_path: str) -> FileResponse:
        if _is_reserved_path(frontend_path, normalized_prefixes):
            raise HTTPException(status_code=404, detail="Not found")

        static_file = _resolve_static_file(static_root, frontend_path)
        if static_file is not None:
            return FileResponse(static_file)

        return FileResponse(index_path)

    return True
