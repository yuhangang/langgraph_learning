const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:3000';

export interface AgentQueryPayload {
  query: string;
  mcpServers?: string[];
  conversationHistory?: Array<{ role: string; content: string }>;
}

export interface AgentResponse {
  response: string;
  toolsUsed?: string[];
  conversationId?: string;
  timestamp?: string;
}

export interface PipelineRunPayload {
  pipelineName: string;
  input: string;
}

export interface PipelineRunResponse {
  pipelineName: string;
  finalOutput: string;
  intent?: string;
  context?: string;
  steps: Array<{
    nodeId: string;
    type: string;
    output: unknown;
  }>;
  timestamp: string;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function queryAgent(payload: AgentQueryPayload) {
  const res = await fetch(`${API_BASE_URL}/agent/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse<AgentResponse>(res);
}

export async function streamAgent(payload: AgentQueryPayload) {
  const res = await fetch(`${API_BASE_URL}/agent/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ response: string; streaming: boolean; timestamp: string }>(res);
}

export async function runPipeline(payload: PipelineRunPayload) {
  const res = await fetch(`${API_BASE_URL}/agent/pipeline/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse<PipelineRunResponse>(res);
}

export async function listMcpTools() {
  const res = await fetch(`${API_BASE_URL}/mcp/tools`);
  return handleResponse<Array<{ name: string; description?: string }>>(res);
}
