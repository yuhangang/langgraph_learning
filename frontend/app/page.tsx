'use client';

import { FormEvent, useCallback, useState } from 'react';
import {
  queryAgent,
  streamAgent,
  runPipeline,
  listMcpTools,
  AgentResponse,
  PipelineRunResponse,
} from '../lib/api';

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

type JsonHistory = Array<{ role: string; content: string }>;

function parseJsonHistory(value: string): JsonHistory | undefined {
  if (!value.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error('History should be an array');
    }
    return parsed;
  } catch (error) {
    throw new Error('Conversation history must be valid JSON.');
  }
}

function parseServers(value: string): string[] | undefined {
  if (!value.trim()) {
    return undefined;
  }
  return value
    .split(',')
    .map(server => server.trim())
    .filter(Boolean);
}

export default function HomePage() {
  const [queryText, setQueryText] = useState('Calculate 25 * 48 and explain the steps');
  const [queryServers, setQueryServers] = useState('math');
  const [queryHistory, setQueryHistory] = useState('');
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryResult, setQueryResult] = useState<AgentResponse | null>(null);

  const [streamText, setStreamText] = useState('Summarize the latest project status update');
  const [streamResult, setStreamResult] = useState<{ response: string; timestamp: string } | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const [pipelineName, setPipelineName] = useState('Customer Support Pipeline');
  const [pipelineInput, setPipelineInput] = useState('Customer cannot access their workspace after password reset');
  const [pipelineResult, setPipelineResult] = useState<PipelineRunResponse | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const [tools, setTools] = useState<Array<{ name: string; description?: string }> | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);

  const handleQuerySubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setQueryLoading(true);
    setQueryError(null);
    try {
      const conversationHistory = parseJsonHistory(queryHistory);
      const mcpServers = parseServers(queryServers);
      const result = await queryAgent({
        query: queryText,
        mcpServers,
        conversationHistory,
      });
      setQueryResult(result);
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : 'Failed to query agent');
    } finally {
      setQueryLoading(false);
    }
  }, [queryHistory, queryServers, queryText]);

  const handleStreamSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setStreamLoading(true);
    setStreamError(null);
    try {
      const result = await streamAgent({ query: streamText });
      setStreamResult({ response: result.response, timestamp: result.timestamp });
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : 'Failed to stream results');
    } finally {
      setStreamLoading(false);
    }
  }, [streamText]);

  const handlePipelineSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setPipelineLoading(true);
    setPipelineError(null);
    try {
      const result = await runPipeline({ pipelineName, input: pipelineInput });
      setPipelineResult(result);
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : 'Failed to run pipeline');
    } finally {
      setPipelineLoading(false);
    }
  }, [pipelineInput, pipelineName]);

  const handleFetchTools = useCallback(async () => {
    setToolsLoading(true);
    setToolsError(null);
    try {
      const result = await listMcpTools();
      setTools(result);
    } catch (error) {
      setToolsError(error instanceof Error ? error.message : 'Failed to fetch tools');
    } finally {
      setToolsLoading(false);
    }
  }, []);

  return (
    <main>
      <header style={{ marginBottom: '2rem' }}>
        <h1>LangGraph Control Center</h1>
        <p style={{ color: 'var(--muted)' }}>
          Backend base URL: <strong>{apiBase}</strong>
        </p>
      </header>

      <div className="grid">
        <section>
          <h2 className="section-title">Query Agent</h2>
          <form onSubmit={handleQuerySubmit}>
            <label>
              Query
              <textarea
                value={queryText}
                onChange={event => setQueryText(event.target.value)}
                rows={4}
                placeholder="Ask the agent anything"
                style={{ marginTop: '0.5rem' }}
                required
              />
            </label>
            <label style={{ display: 'block', marginTop: '1rem' }}>
              MCP Servers (comma separated)
              <input
                type="text"
                value={queryServers}
                onChange={event => setQueryServers(event.target.value)}
                placeholder="math,filesystem"
              />
            </label>
            <label style={{ display: 'block', marginTop: '1rem' }}>
              Conversation History (JSON)
              <textarea
                value={queryHistory}
                onChange={event => setQueryHistory(event.target.value)}
                rows={4}
                placeholder='[{"role":"user","content":"Hi"}]'
              />
            </label>
            <button type="submit" disabled={queryLoading} style={{ marginTop: '1rem' }}>
              {queryLoading ? 'Submitting...' : 'Send Query'}
            </button>
          </form>
          {queryError && <p style={{ color: '#f87171', marginTop: '1rem' }}>{queryError}</p>}
          {queryResult && (
            <div className="result-card">
              <p style={{ marginBottom: '0.25rem' }}>Answer:</p>
              <pre>{queryResult.response}</pre>
              {queryResult.toolsUsed?.length ? (
                <p style={{ color: 'var(--muted)' }}>Tools: {queryResult.toolsUsed.join(', ')}</p>
              ) : null}
            </div>
          )}
        </section>

        <section>
          <h2 className="section-title">Stream Agent Response</h2>
          <form onSubmit={handleStreamSubmit}>
            <label>
              Prompt
              <textarea
                value={streamText}
                onChange={event => setStreamText(event.target.value)}
                rows={4}
                required
                style={{ marginTop: '0.5rem' }}
              />
            </label>
            <button type="submit" disabled={streamLoading} style={{ marginTop: '1rem' }}>
              {streamLoading ? 'Streaming...' : 'Start Stream'}
            </button>
          </form>
          {streamError && <p style={{ color: '#f87171', marginTop: '1rem' }}>{streamError}</p>}
          {streamResult && (
            <div className="result-card">
              <p>Completed at {new Date(streamResult.timestamp).toLocaleTimeString()}</p>
              <pre>{streamResult.response}</pre>
            </div>
          )}
        </section>

        <section>
          <h2 className="section-title">Run Pipeline</h2>
          <form onSubmit={handlePipelineSubmit}>
            <label>
              Pipeline Name
              <input
                type="text"
                value={pipelineName}
                onChange={event => setPipelineName(event.target.value)}
                required
                style={{ marginTop: '0.5rem' }}
              />
            </label>
            <label style={{ display: 'block', marginTop: '1rem' }}>
              Input
              <textarea
                value={pipelineInput}
                onChange={event => setPipelineInput(event.target.value)}
                rows={4}
                required
              />
            </label>
            <button type="submit" disabled={pipelineLoading} style={{ marginTop: '1rem' }}>
              {pipelineLoading ? 'Running...' : 'Execute Pipeline'}
            </button>
          </form>
          {pipelineError && <p style={{ color: '#f87171', marginTop: '1rem' }}>{pipelineError}</p>}
          {pipelineResult && (
            <div className="result-card">
              <p style={{ marginBottom: '0.25rem' }}>Final Output:</p>
              <pre>{pipelineResult.finalOutput}</pre>
              <p style={{ margin: '0.5rem 0' }}>Steps:</p>
              <pre>{JSON.stringify(pipelineResult.steps, null, 2)}</pre>
            </div>
          )}
        </section>

        <section>
          <h2 className="section-title">MCP Tools</h2>
          <p style={{ color: 'var(--muted)' }}>Inspect which MCP tools are currently available.</p>
          <button onClick={handleFetchTools} disabled={toolsLoading}>
            {toolsLoading ? 'Loading...' : 'Refresh Tools'}
          </button>
          {toolsError && <p style={{ color: '#f87171', marginTop: '1rem' }}>{toolsError}</p>}
          {tools && (
            <div className="result-card">
              {tools.length === 0 ? (
                <p>No tools registered.</p>
              ) : (
                <ul style={{ paddingLeft: '1.25rem' }}>
                  {tools.map(tool => (
                    <li key={tool.name} style={{ marginBottom: '0.5rem' }}>
                      <strong>{tool.name}</strong>
                      {tool.description ? (
                        <span style={{ color: 'var(--muted)', marginLeft: '0.25rem' }}>
                          {tool.description}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
