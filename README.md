# NestJS LangGraph MCP Platform with Google Gemini

A production-ready NestJS platform integrating LangChain, LangGraph, MCP (Model Context Protocol), and Google Gemini API.

## Features

- 🤖 LangGraph agents with Google Gemini
- 🔧 MCP tool integration
- 📚 Swagger API documentation
- ✅ Input validation
- 🔄 Streaming support
- 🎯 Modular architecture
- 🧠 Optional PostgreSQL + pgvector persistence for knowledge bases

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file:

```env
GOOGLE_API_KEY=your_google_api_key_here
PORT=3000
NODE_ENV=development
# Optional: point to a different workflow definition file
PIPELINE_CONFIG_PATH=config.json
# Optional: enable PostgreSQL vector storage
# VECTOR_DB_URL=postgresql://langgraph:langgraph@localhost:5432/langgraph
# Optional: persist customer chat history (defaults to DATABASE_URL when set)
# CHAT_DB_URL=postgresql://langgraph:langgraph@localhost:5432/langgraph_chat
```

## Running the Application

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod

# Docker
docker build -t langgraph-api .
```

### Docker & Compose

1. Create a `.env` with `GOOGLE_API_KEY`, `PIPELINE_CONFIG_PATH`, etc. (see above).
2. To bake only the API image: `docker build -t langgraph-api .`
3. To launch the API plus a pgvector-backed PostgreSQL instance, use the provided compose file:

```bash
docker-compose up --build
```

The API will be available on `http://localhost:3000`, while PostgreSQL listens on `localhost:5432`
with default credentials `langgraph/langgraph`. The compose stack automatically points
`VECTOR_DB_URL` at the pgvector container so embeddings persist across restarts.

Vector embeddings are persisted via PostgreSQL + pgvector. Set `VECTOR_DB_URL` (or `DATABASE_URL`)
to your instance and the service will manage the schema automatically.

## Next.js Frontend

An optional dashboard lives in `frontend/`. It targets the NestJS APIs and can be run locally:

```bash
cd frontend
npm install
npm run dev
```

Set `NEXT_PUBLIC_API_BASE_URL` inside `frontend/.env.local` if your backend is not running on `http://localhost:3000`.

## API Endpoints

### Agent Endpoints

- `POST /agent/query` - Send query to agent
- `POST /agent/stream` - Stream agent response
- `POST /agent/pipeline/run` - Execute a configured workflow pipeline
- `GET /agent/health` - Check agent health
- `GET /agent/conversations` - List stored customer conversations
- `GET /agent/conversations/:conversationId` - Fetch a specific conversation + history

### MCP Endpoints

- `GET /mcp/tools` - List available MCP tools
- `GET /mcp/health` - Check MCP service health

### Documentation

- `GET /api/docs` - Swagger API documentation

## Example Usage

```bash
# Query the agent
curl -X POST http://localhost:3000/agent/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Calculate 25 * 48 and explain the steps"
  }'

# List available tools
curl http://localhost:3000/mcp/tools

# Run a configured workflow pipeline
curl -X POST http://localhost:3000/agent/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{
    "pipelineName": "Customer Support Pipeline",
    "input": "Customer cannot access their workspace after password reset"
  }'
```

### Customer Service Chat & History

- `POST /agent/query` automatically creates a conversation (unless you pass `conversationId`) and stores both user and assistant turns in PostgreSQL when `CHAT_DB_URL` or `DATABASE_URL` is configured. Without a database it falls back to in-memory storage.
- Include `customerId`, `subject`, and arbitrary `metadata` in the request to persist attribution data with the conversation.
- Invoke `GET /agent/conversations` to page through recent threads or `GET /agent/conversations/:conversationId` to retrieve the full transcript for audits or UI playback.

## Configuring Pipelines

Pipelines are stored in `config.json`. Each pipeline lists an ordered set of nodes (LLMs or retrievers) plus the edges that describe execution order. The default `Customer Support Pipeline` ships with a lightweight knowledge base (`knowledgeBases.tenant1_kb`) that the retriever node consults before generating the final response.

See `docs/pipeline-config.md` for the full JSON schema, node types, and knowledge-base guidance.

To add or edit workflows:

1. Update `config.json` with the desired nodes/edges and optional knowledge base entries.
2. Restart the NestJS server so that `AgentService` can reload the configuration.
3. Call `POST /agent/pipeline/run` with `pipelineName` and the end-user `input`.

Only Google Gemini is provisioned out of the box; referencing other models (e.g., Claude) in the config will automatically fall back to Gemini unless additional credentials are wired in.

### Client-specific example (client_1)

- `config.client1.json` contains a ready-to-use “Client 1 Multi-Step Support” workflow plus a curated `client_1_kb`. Point `PIPELINE_CONFIG_PATH=config.client1.json` in your `.env` to activate it.
- Each knowledge-base entry accepts `summary`, `keywords`, and `priority` so the retriever can build a lightweight inverted index for faster lookups. Use short keywords (product names, ticket codes) and raise `priority` for the most accurate policies.
- Keep the file under version control per client, or store it in object storage and mount it during deployment for clean separation between tenants.
- Need durable embeddings beyond process memory? Set `VECTOR_DB_URL` (or `DATABASE_URL`) to a PostgreSQL
  instance with pgvector and follow `docs/vector-store.md` to persist and query knowledge entries
  semantically.

## Architecture

```
src/
├── agent/              # LangGraph agent logic
│   ├── agent.controller.ts
│   ├── agent.service.ts
│   ├── agent.module.ts
│   └── dto/
├── mcp/                # MCP integration
│   ├── mcp.controller.ts
│   ├── mcp.service.ts
│   └── mcp.module.ts
├── app.module.ts
└── main.ts
```

## Adding New MCP Servers

Edit `src/mcp/mcp.service.ts`:

```typescript
const mcpServers = {
  math: { ... },
  yourServer: {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-yourserver'],
  },
};
```

## License

MIT
