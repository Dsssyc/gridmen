# Gridmen

<p align="center">
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-36.2.1-47848F?logo=electron&logoColor=white" alt="Electron 36.2.1"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19.1.0-61DAFB?logo=react&logoColor=white" alt="React 19.1.0"></a>
  <a href="https://vitejs.dev/"><img src="https://img.shields.io/badge/Vite-7.0.0-646CFF?logo=vite&logoColor=white" alt="Vite 7.0.0"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8%2F5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.8/5.9"></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind%20CSS-4.1.11-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4.1.11"></a>
  <a href="https://fastapi.tiangolo.com/"><img src="https://img.shields.io/badge/FastAPI-0.116.1-009688?logo=fastapi&logoColor=white" alt="FastAPI 0.116.1"></a>
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white" alt="Python 3.12+"></a>
</p>

Gridmen is a desktop + web GIS-style grid editing and visualization workspace.
It combines an Electron shell, a React/Vite renderer, and a Python (FastAPI) backend.

## Repository Layout

High-level structure (monorepo):

```text
.
├─ package.json                # Workspace orchestration (concurrently)
├─ client/                     # Electron desktop shell
│  ├─ package.json             # Electron dependencies + build script
│  ├─ electron/                # Electron main/preload process (TypeScript)
│  └─ src/                     # Renderer app (Vite + React)
│     ├─ package.json          # Frontend dependencies
│     ├─ vite.config.ts        # Dev server + proxy + build output
│     └─ src/                  # React app source (components/core/store/views/...)
├─ server/                     # Python backend project (uv + FastAPI)
│  ├─ pyproject.toml           # Python deps/constraints (incl. GIS stack)
│  ├─ main.py                  # Uvicorn entrypoint
│  └─ py-noodle/               # Local editable dependency used by backend
├─ src/                        # Backend source package (gridmen_backend)
├─ templates/                  # Frontend build output target (generated)
├─ resource/                   # Example datasets / resources
└─ temp/                       # Runtime/temp artifacts
```

## Main Tech Stack (with versions)

Versions are taken from manifests in this repository (e.g. `package.json`, `pyproject.toml`).

<p align="center">
  <a href="https://docs.mapbox.com/mapbox-gl-js/api/"><img src="https://img.shields.io/badge/Mapbox%20GL-3.13.0-000000?logo=mapbox&logoColor=white" alt="Mapbox GL 3.13.0"></a>
  <a href="https://threejs.org/"><img src="https://img.shields.io/badge/three.js-0.180.0-000000?logo=three.js&logoColor=white" alt="three.js 0.180.0"></a>
  <a href="https://zustand-demo.pmnd.rs/"><img src="https://img.shields.io/badge/Zustand-5.0.8-181717?logo=react&logoColor=white" alt="Zustand 5.0.8"></a>
  <a href="https://eslint.org/"><img src="https://img.shields.io/badge/ESLint-9.37.0-4B32C3?logo=eslint&logoColor=white" alt="ESLint 9.37.0"></a>
  <a href="https://prettier.io/"><img src="https://img.shields.io/badge/Prettier-3.6.2-F7B93E?logo=prettier&logoColor=black" alt="Prettier 3.6.2"></a>
</p>

<p align="center">
  <a href="https://www.uvicorn.org/"><img src="https://img.shields.io/badge/Uvicorn-0.30.0-2C3E50" alt="Uvicorn 0.30.0"></a>
  <a href="https://docs.pydantic.dev/"><img src="https://img.shields.io/badge/Pydantic-2.x-E92063?logo=pydantic&logoColor=white" alt="Pydantic 2.x"></a>
  <a href="https://numpy.org/"><img src="https://img.shields.io/badge/NumPy-2.2.6%2B-013243?logo=numpy&logoColor=white" alt="NumPy 2.2.6+"></a>
  <a href="https://pandas.pydata.org/"><img src="https://img.shields.io/badge/pandas-2.3.3%2B-150458?logo=pandas&logoColor=white" alt="pandas 2.3.3+"></a>
  <a href="https://gdal.org/"><img src="https://img.shields.io/badge/GDAL-3.12.x-5CAE58" alt="GDAL 3.12.x"></a>
  <a href="https://rasterio.readthedocs.io/"><img src="https://img.shields.io/badge/rasterio-1.4.4%2B-3E7A7C" alt="rasterio 1.4.4+"></a>
</p>

For full dependency lists, see `client/package.json`, `client/src/package.json`, and `server/pyproject.toml`.

## Getting Started

### Prerequisites

- **Node.js** (v18 or higher recommended)
- **Python** (3.12 or higher)
- **uv** (Python package manager) - [Install uv](https://github.com/astral-sh/uv)

### Installation

#### 1. Frontend Dependencies

Install Electron dependencies:

```bash
cd ./client
npm install
```

Install renderer (React/Vite) dependencies:

```bash
cd ./client/src
npm install
```

#### 2. Environment Configuration

Create a `.env` file in `client/src/` with the following content:

```env
# Replace with your local API URL, e.g., http://localhost:8000
VITE_LOCAL_API_URL=http://localhost:8000

# Replace with your remote API URL, e.g., http://xxx.yyy.zzz.www:8000
VITE_REMOTE_API_URL=http://localhost:8000

# Replace with your Mapbox token, e.g., pk.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_MAP_TOKEN=your_mapbox_token_here
```

> **Note**: Get your Mapbox token from [Mapbox Account](https://account.mapbox.com/access-tokens/)

#### 3. Backend Dependencies

Navigate to the server directory and install Python dependencies:

```bash
cd server
uv run main.py
```

This will automatically:
- Create a virtual environment in `.venv/`
- Install all dependencies listed in `pyproject.toml`
- Start the FastAPI server on `http://localhost:8000`

### Running the Application

From the repository root:

```bash
npm start
```

This command will concurrently:
- Start Electron desktop shell (`client/`)
- Launch Vite dev server (`client/src/`) on `http://127.0.0.1:5173`
- Run the FastAPI backend (`server/`) on `http://localhost:8000`

### Individual Development Servers

If you prefer to run components separately:

**Frontend only** (Vite dev server):
```bash
cd ./client/src
npm run dev
```

**Electron desktop only**:
```bash
cd ./client
npm start
```

**Backend only**:
```bash
cd ./server
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
uv run main.py
```

### Notes

- The Vite dev server proxies `/api` and `/noodle` requests to `VITE_LOCAL_API_URL`
- Frontend build output is configured to go to `templates/`
- Press `F12` in the Electron app to toggle DevTools
