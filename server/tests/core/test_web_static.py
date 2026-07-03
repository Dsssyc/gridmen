from fastapi import FastAPI
from fastapi.testclient import TestClient

from gridmen_backend.web import (
    PublicBasePathMiddleware,
    mount_static_frontend,
)


def test_public_base_path_middleware_strips_gridmen_prefix():
    app = FastAPI()
    app.add_middleware(PublicBasePathMiddleware, public_base_path="/gridmen")

    @app.get("/api/health")
    def health():
        return {"ok": True}

    client = TestClient(app)

    assert client.get("/gridmen/api/health").json() == {"ok": True}
    assert client.get("/api/health").json() == {"ok": True}


def test_static_frontend_serves_spa_and_static_assets(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log('gridmen')", encoding="utf-8")
    (tmp_path / "index.html").write_text("<html><body>Gridmen</body></html>", encoding="utf-8")

    app = FastAPI()
    mount_static_frontend(app, static_dir=tmp_path, api_prefixes=("/api", "/noodle"))
    client = TestClient(app)

    assert "Gridmen" in client.get("/").text
    assert "Gridmen" in client.get("/framework").text
    assert client.get("/assets/app.js").text == "console.log('gridmen')"
    assert client.get("/api/missing").status_code == 404
