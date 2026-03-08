# inflib.io

The Infinite Canvas is a browser app that treats every 512×512 image as a discoverable location in a complete mathematical library. Nothing is stored. The image bytes are transformed into an address with a deterministic reversible cipher and can be restored from that address later with the same library key.

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

## Docker / Coolify

This repo includes:

- `Dockerfile` for a multi-stage static build
- `docker-compose.yml` for direct deployment in Coolify
- `nginx.conf` for SPA routing

Run locally with Docker:

```bash
docker compose up --build
```

The app will be served on port `8080` by default.
