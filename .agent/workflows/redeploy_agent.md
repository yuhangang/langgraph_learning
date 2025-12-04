---
description: Redeploy the LangGraph Agent API
---
Use this workflow to rebuild and restart the Agent API service. This is necessary when you change:
- Source code (`src/**/*.ts`)
- Configuration files (`config/*.json`)
- `.env` file
- `Dockerfile` or `docker-compose.yml`

Steps:

1. Rebuild and restart the API service
// turbo
docker compose up --build -d api

2. (Optional) Follow the logs to verify startup
docker compose logs -f api
