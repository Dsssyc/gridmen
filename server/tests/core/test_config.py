from gridmen_backend.core.config import Settings


def test_settings_accepts_release_debug_env(monkeypatch):
    monkeypatch.setenv("DEBUG", "release")

    settings = Settings(_env_file=None)

    assert settings.DEBUG is False


def test_settings_accepts_production_debug_env(monkeypatch):
    monkeypatch.setenv("DEBUG", "production")

    settings = Settings(_env_file=None)

    assert settings.DEBUG is False
