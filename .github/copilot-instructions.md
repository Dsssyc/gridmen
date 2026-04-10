# Copilot Instructions — Gridmen

Gridmen is a desktop + web GIS grid-editing workspace. It is a monorepo with three process layers that run concurrently:

| Layer | Location | Tech | Runs on |
|-------|----------|------|---------|
| Electron shell | `client/electron/` | Electron 36, TypeScript | Main process |
| Renderer app | `client/src/` | React 19, Vite 7, TypeScript | `http://127.0.0.1:5173` |
| Backend | `server/` | FastAPI, Python 3.12+, uv | `http://localhost:8000` |

## Commands

### Run everything (from repo root)

```bash
npm start          # concurrently: Electron + Vite dev server + FastAPI
```

### Frontend (renderer)

```bash
cd client/src
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build (output → templates/)
npm run lint       # ESLint (flat config, TS + React rules)
```

### Backend

```bash
cd server
uv run main.py                    # Start FastAPI (auto-installs deps on first run)
uv run pytest py-noodle/tests/    # Run py-noodle tests
uv run pytest py-noodle/tests/crms/test_schema.py   # Single test file
```

### Electron

```bash
cd client
npm start          # Builds electron TS then launches
```

## Architecture

### Frontend (client/src/src/)

**Template–View–Store pattern.** The UI is organized around domain templates, each owning its menu actions, map interactions, and data logic:

- **Templates** (`template/`) — Domain models (Grid, Patch, Vector, Schema, Default). Each implements `ITemplate` with `renderMenu`, `handleMenuOpen`, and per-view functions (`checkMapView`, `creationMapView`, `editMapView`). Registered in `templateRegistry.ts`.
- **Views** (`views/`) — Presentation components (MapView with Mapbox GL, TableView with TanStack Table, DefaultView). Registered in `viewRegistry.ts` and receive view models from templates.
- **Stores** (`store/`) — Zustand hooks (`useSettingStore`, `useLayerStore`, `useSelectedNodeStore`, etc.) with localStorage persistence via `createJSONStorage`. A legacy `store.ts` uses a singleton `Map` for transient state (loading, CLG reference).
- **API layer** (`template/api/`) — Fetch-based, organized by domain: `node.ts`, `grid.ts`, `patch.ts`, `vector.ts`, `proj.ts`. Requests go through Vite's proxy (`/api` and `/noodle` → backend).

**Component library:** shadcn/ui primitives live in `components/ui/` (Radix UI + CVA variants + `cn()` utility from `clsx` + `tailwind-merge`).

**3D visualization** (`threejs/`) — Three.js scene management, 3D tileset rendering, Gaussian splat point clouds. Separate from the Mapbox 2D layer.

**Resource tree** (`components/resourceTree.tsx`) — Hierarchical node tree with drag-and-drop, context menus, and CRUD. Drives template selection and view routing.

### Backend (server/)

**ICRM/CRM pattern** — Interface-driven resource model system backed by the `c-two` framework:

- **ICRM interfaces** (`icrms/`) — Abstract protocols decorated with `@cc.icrm(namespace='gridmen', version='1.0.0')`. Define contracts: `ISchema`, `IPatch`, `IVector`, `IGrid`, `IProj`.
- **CRM implementations** (`crms/`) — Concrete classes implementing ICRM interfaces. Handle file I/O, coordinate transforms (PyProj/GDAL), and grid computation.
- **Registration** — ICRMs and node templates are registered in `noodle.config.yaml` by tag (e.g., `gridmen/IPatch/1.0.0`) and module path.

**Py-Noodle** (`server/py-noodle/`, git submodule from `world-in-progress/py-noodle`) — "Node-Oriented Data Linking Environment." SQLite-backed hierarchical tree database (`noodle.db`) managing resource nodes. Initialized/terminated via `NOODLE_INIT`/`NOODLE_TERMINATE` in the FastAPI lifespan. Access pattern:

```python
with noodle.connect(IPatch, node_key, 'pr', lock_id=lock_id) as patch:
    levels, global_ids = patch.get_activated_cell_infos()
```

**API routes** — All under `/api` prefix. Routers composed in `src/gridmen_backend/api/__init__.py`: `/api/schema`, `/api/grid`, `/api/patch`, `/api/vector`, `/api/proj`.

**Settings** — Pydantic `BaseSettings` in `core/config.py`. Paths (SQLITE_PATH, MEMORY_TEMP_PATH, NOODLE_CONFIG_PATH) and server config are injected into env vars on startup.

### Electron (client/electron/)

Thin shell: creates a `BrowserWindow` that loads the Vite dev server (dev) or `templates/index.html` (production). Exposes file-dialog IPC handlers via `contextBridge` (`preload.ts`): `openFileDialog` (.shp, .geojson), `openTiffFileDialog`, `openTxtFileDialog`, `openInpFileDialog`, `openCsvFileDialog`, `openFolderDialog`. Context isolation is enabled; `nodeIntegration` is off.

## Conventions

### TypeScript / React

- **Path alias:** `@/` maps to `client/src/src/` — use it for all imports within the renderer app.
- **Styling:** Tailwind CSS (primary) with `cn()` utility for conditional classes. Styled Components used sparingly for complex CSS animations (e.g., `loader.tsx`).
- **State:** Zustand stores with `use` prefix. Persistent stores use `persist` middleware with `createJSONStorage(() => localStorage)`.
- **Components:** Radix UI primitives wrapped as shadcn/ui in `components/ui/`. Use CVA (`class-variance-authority`) for variant definitions.
- **Icons:** Lucide React exclusively.
- **Notifications:** Sonner toast library.
- **Routing:** React Router v7 with routes defined in `framework.tsx`.

### Python

- **Type hints:** Modern Python 3.10+ syntax throughout (`tuple[float, float]`, `str | None`, `list[...]`).
- **Docstrings:** Triple-quoted with `Description\n--\n` section marker.
- **Paths:** `pathlib.Path` exclusively — no `os.path`.
- **Validation:** Pydantic models for all API request/response schemas. Use `@field_validator` for custom rules.
- **Errors:** Raise `HTTPException` with appropriate status codes.
- **Logging:** `logging.getLogger(__name__)` per module.
- **Binary data:** PyArrow schemas for efficient grid/cell serialization; custom `combine_bytes()` for binary payloads.

### Prettier (client/src/)

```json
{
  "semi": false,
  "singleQuote": false,
  "printWidth": 120,
  "tabWidth": 4,
  "trailingComma": "es5",
  "arrowParens": "avoid"
}
```

## Environment

The renderer requires a `client/src/.env` file:

```env
VITE_LOCAL_API_URL=http://localhost:8000
VITE_REMOTE_API_URL=http://localhost:8000
VITE_MAP_TOKEN=<mapbox-access-token>
```

Vite proxies `/api` and `/noodle` requests to `VITE_LOCAL_API_URL`. The frontend build output goes to `server/templates/` for Electron production use.
