# Deploying Reflex (Render)

You need **two web services** on Render — one for the FastAPI backend, one for the Next.js frontend.

## Option A — automated (Blueprint)

We ship a `render.yaml` at the repo root. In Render: **New → Blueprint → connect this repo → apply**. It will create both services and prompt you for the secrets.

## Option B — manual (matches the form you're filling out)

### Service 1: `reflex-api` (Python web service)

| Field | Value |
|---|---|
| Runtime | Python |
| Root Directory | *(leave blank)* |
| Build Command | `pip install -r apps/api/requirements.txt` |
| Start Command | `ddtrace-run uvicorn apps.api.main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |
| Python Version (env) | `3.12` |

Add all the **env vars from `.env.example`** as secrets in the Environment tab. The non-secret ones (model names, URLs, flags) can be plain values.

### Service 2: `reflex-web` (Node web service)

| Field | Value |
|---|---|
| Runtime | Node |
| Root Directory | `apps/web` |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start -- -p $PORT` |
| Node Version (env) | `20` |
| `NEXT_PUBLIC_API_BASE` | `https://<your-reflex-api>.onrender.com` (from service 1's URL) |

### Notes

- Render free tier spins down idle services; the autonomous monitor stops while the API is asleep. Upgrade to **Starter ($7/mo)** if you want the monitor to keep polling 24/7.
- ClickHouse Cloud / Senso / NVIDIA NIM / NimbleWay / Datadog all run as external services; you just need their API keys in env vars.
- Don't commit `.env` (it's in `.gitignore`). Add each secret in the Render dashboard.

### Sanity check after deploy

```bash
curl https://<your-reflex-api>.onrender.com/health
curl https://<your-reflex-api>.onrender.com/api/v1/monitor/status
curl https://<your-reflex-api>.onrender.com/api/v1/cost
```

Then open `https://<your-reflex-web>.onrender.com/` and `/ops` and `/pricing`.
