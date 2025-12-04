# Workflow & Knowledge Base Configuration

This service loads its workflow definitions from a JSON document (`config.json` by default, or any file referenced by `PIPELINE_CONFIG_PATH`). Each file has two top-level objects:

```json5
{
  "pipelines": [ /* array of pipeline definitions */ ],
  "knowledgeBases": { /* reusable knowledge sources */ }
}
```

## Pipelines

Pipelines describe the ordered steps required to fulfil a client workflow. Each pipeline contains:

| Field | Description |
| --- | --- |
| `name` | Unique, human-readable pipeline identifier. Used by `POST /agent/pipeline/run`. |
| `description` | Optional helper text for operators. |
| `nodes` | Ordered list of steps (LLM or retriever) with per-node config. |
| `edges` | Optional DAG describing dependencies. If omitted, nodes run in declaration order. |

### Node Types

- **LLM Node (`type: "llm"`)**
  - `model`: Desired model name (falls back to Gemini if unsupported).
  - `temperature`, `maxOutputTokens`: Optional overrides.
  - `prompt`: Template string. Tokens such as `{input}`, `{intent}`, `{context}`, `{last_output}`, and `{nodeId}` can be interpolated.

- **Retriever Node (`type: "retriever"`)**
  - `source`: Key inside `knowledgeBases`.
  - `top_k`: Number of snippets to return (default 3).

### Example

```json5
{
  "name": "Client 1 Multi-Step Support",
  "nodes": [
    { "id": "client1_intent_classifier", "type": "llm", "config": { "prompt": "... {input}" } },
    { "id": "client1_kb_retrieval", "type": "retriever", "config": { "source": "client_1_kb", "top_k": 4 } },
    { "id": "client1_response_generator", "type": "llm", "config": { "prompt": "Intent: {intent}\nContext: {context}\n..." } }
  ],
  "edges": [
    { "from": "client1_intent_classifier", "to": "client1_kb_retrieval" },
    { "from": "client1_kb_retrieval", "to": "client1_response_generator" }
  ]
}
```

## Knowledge Bases

Each knowledge base entry powers the retriever node’s local search. The agent builds an inverted index using the fields below, so concise metadata significantly improves recall.

| Field | Required | Purpose |
| --- | --- | --- |
| `id` | No | Stable identifier useful for observability. |
| `title` | Yes | Displayed in snippets (`Snippet 1 - <title>`). |
| `content` | Yes | Full text inserted into the prompt context. |
| `summary` | No | One-line recap shown before the full text. |
| `tags` | No | Short descriptors. Add product SKUs, feature names, severity, etc. |
| `keywords` | No | Additional search tokens (ticket codes, acronyms). |
| `priority` / `weight` | No | Boost important snippets (>1.0). |

Example entry from `config.client1.json`:

```json5
{
  "id": "client1_workspace_access",
  "title": "Client 1 Workspace Access SOP",
  "summary": "Checklist for login failures and workspace membership issues.",
  "content": "Verify Okta status, confirm workspace membership...",
  "tags": ["workspace", "sso", "access"],
  "keywords": ["okta", "workspace", "token", "login"],
  "priority": 1.4
}
```

Each entry is vectorized automatically using Google's `embedding-001` model when the config
file is loaded. The agent combines those semantic vectors with the lightweight keyword index,
so richer summaries, tags, and keywords improve both recall modes. Ensure `GOOGLE_API_KEY`
is set because the same credential powers the embedding requests.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PIPELINE_CONFIG_PATH` | `config.json` | Absolute or relative path to the workflow file. |
| `GOOGLE_API_KEY` | _(required)_ | API key for Gemini models used by every LLM node. |
| `VECTOR_DB_URL` / `DATABASE_URL` | _(unset)_ | Optional PostgreSQL connection string (with pgvector) for persisting embeddings. |

Set `PIPELINE_CONFIG_PATH=config.client1.json` (or any other tenant-specific file) to hot-swap workflows without code changes; restart the NestJS app after editing the config so the new pipelines and knowledge bases are indexed.

See `docs/vector-store.md` for PostgreSQL/pgvector setup instructions when enabling the vector store.

## Validation Tips

1. Run `npm run build` to ensure TypeScript definitions compile after changing the workflow logic.
2. Hit `POST /agent/pipeline/run` with the pipeline name to verify end-to-end execution.
3. Inspect the `steps` array in the response to confirm each node produced the expected output and knowledge matches were ranked correctly.
