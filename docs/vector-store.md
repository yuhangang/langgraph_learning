# PostgreSQL Vector Store Setup

The agent can persist embeddings inside PostgreSQL (with the [`pgvector`](https://github.com/pgvector/pgvector)
extension) so knowledge-base refreshes survive restarts and similarity search scales beyond
the in-memory index. This document walks through the local setup.

## 1. Run PostgreSQL with pgvector

Use the official pgvector image in Docker:

```bash
docker run -d \
  --name langgraph-pgvector \
  -e POSTGRES_USER=langgraph \
  -e POSTGRES_PASSWORD=langgraph \
  -e POSTGRES_DB=langgraph \
  -p 5432:5432 \
  ankane/pgvector
```

The container already ships with the `vector` extension enabled. For a self-managed PostgreSQL
instance, install pgvector first (see the upstream docs) and then enable it per database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 2. Create the knowledge table

The service auto-creates the required table/indexes at startup, but you can run the SQL manually
as a sanity check:

```sql
CREATE TABLE IF NOT EXISTS knowledge_vectors (
  source   text            NOT NULL,
  entry_id text            NOT NULL,
  title    text            NOT NULL,
  content  text            NOT NULL,
  metadata jsonb,
  embedding vector(768),
  PRIMARY KEY (source, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_source
  ON knowledge_vectors(source);

CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_embedding
  ON knowledge_vectors USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

> **Note:** Creating the `ivfflat` index requires PostgreSQL 14+ and the pgvector extension.

## 3. Configure the backend

Install the Node PostgreSQL driver:

```bash
npm install pg
```

Set the connection string in `.env`:

```env
VECTOR_DB_URL=postgresql://langgraph:langgraph@localhost:5432/langgraph
```

`VECTOR_DB_URL` takes precedence, but the service will fall back to `DATABASE_URL` if it is set.

The `VectorStoreService` will:

1. Connect to PostgreSQL during `AgentService` initialization.
2. Create the table/indexes (if allowed).
3. Rebuild the `knowledge_vectors` table every time the workflow config reloads.
4. Run semantic searches using `embedding <=> query` distance when retriever nodes execute.

If the `pg` package is not installed or the connection string is missing, the service logs a
warning and falls back to the in-memory index-only retrieval path.

## 4. Verifying

1. Start the NestJS backend with the `.env` variables set.
2. Watch the logs for `Vector store connected to PostgreSQL.` to confirm the driver is active.
3. Call `POST /agent/pipeline/run` once; entries from the configured `knowledgeBases` should
   appear inside `knowledge_vectors`.
4. Subsequent retriever steps will pull matches from PostgreSQL when embeddings exist; the
   service automatically falls back to lexical ranking if the vector store returns zero rows.

### Using Docker Compose

The repo ships with `docker-compose.yml`, which boots both services in one command:

```bash
docker-compose up --build
```

This spins up:

- `pgvector`: the PostgreSQL instance preloaded with pgvector.
- `api`: the NestJS app with `VECTOR_DB_URL` already pointed at the pgvector service.

Make sure your `.env` (referenced via `env_file`) includes `GOOGLE_API_KEY` and any pipeline
config paths; compose will automatically set the vector connection string override.

This approach keeps the JSON config workflow authoring experience, while giving you
durable, indexable semantic search for larger deployments.
