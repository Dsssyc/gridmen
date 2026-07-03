# Gridmen Web Deployment

This branch prepares Gridmen to run as a web app behind a `/gridmen/` reverse-proxy prefix without Docker.

## Local Build

Build the deployable frontend from the repository root:

```bash
npm run build:web
```

The generated files land in the repository-root `templates/` directory. That
directory is a local build artifact and is intentionally ignored by Git.

The script sets these build-time defaults:

```env
VITE_PUBLIC_BASE_PATH=/gridmen/
VITE_API_BASE_URL=/gridmen
```

`client/src/.env` is still loaded by Vite, so an existing `VITE_MAP_TOKEN=pk...` is compiled into the frontend bundle. Do not use a Mapbox `sk...` secret token in frontend env files.

## Local Server Smoke Test

After building, start FastAPI serving the compiled frontend:

```bash
npm run start:web
```

Then open:

```text
http://127.0.0.1:8000/gridmen/
```

The local server accepts both prefixed and unprefixed backend paths:

```text
/gridmen/api/... -> /api/...
/gridmen/noodle/... -> /noodle/...
```

That lets the same frontend bundle work locally and behind an Nginx `/gridmen/` proxy.

For a server process, set `DEBUG=production` so Uvicorn does not run with the
development reloader:

```bash
DEBUG=production SERVER_HOST=127.0.0.1 SERVER_PORT=18084 npm run start:web
```

## Nginx Shape

When deploying on `gridmen-server`, keep the existing root portal routes intact and add only a Gridmen-specific location:

```nginx
location = /gridmen { return 301 /gridmen/; }

location /gridmen/ {
    proxy_pass http://127.0.0.1:18084;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /gridmen;
}
```

Run `nginx -t` in the existing gateway container before reload.
