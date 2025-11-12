# LangGraph Frontend

Next.js dashboard for interacting with the LangGraph NestJS backend.

## Setup

```bash
cd frontend
npm install
```

Create a `.env.local` (optional) to point at a remote backend:

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
```

## Scripts

```bash
npm run dev    # start Next.js in development mode
npm run build  # production build
npm run start  # serve the production build
npm run lint   # run ESLint
```

## Features

- Send synchronous queries to `/agent/query`
- Initiate `/agent/stream` requests
- Run configured workflows via `/agent/pipeline/run`
- Inspect registered MCP tools from `/mcp/tools`
