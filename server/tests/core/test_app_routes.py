import sys
from pathlib import Path

from fastapi.testclient import TestClient

SERVER_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SERVER_ROOT))

from gridmen_backend import main as main_module


def test_noodle_routes_precede_static_frontend_fallback(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<html><body>Gridmen</body></html>", encoding="utf-8")
    monkeypatch.setattr(main_module.settings, "WEB_STATIC_DIR", str(tmp_path))

    app = main_module.create_app()

    with TestClient(app):
        route_paths = [getattr(route, "path", "") for route in app.routes]

    assert route_paths.index("/noodle/node/") < route_paths.index("/{frontend_path:path}")
