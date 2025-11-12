import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { McpService } from '../mcp/mcp.service';
import { AgentQueryDto, AgentResponseDto } from './dto/agent-query.dto';
import {
  PipelineRunDto,
  PipelineRunResponseDto,
  PipelineStepDto,
} from './dto/pipeline-run.dto';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';

type PipelineNodeType = 'llm' | 'retriever';

interface PipelineNode {
  id: string;
  type: PipelineNodeType;
  config?: Record<string, any>;
}

interface PipelineEdge {
  from: string;
  to: string;
}

interface PipelineDefinition {
  name: string;
  nodes: PipelineNode[];
  edges?: PipelineEdge[];
}

interface KnowledgeBaseEntry {
  id?: string;
  title: string;
  content: string;
  summary?: string;
  tags?: string[];
  keywords?: string[];
  priority?: number;
  weight?: number;
}

interface IndexedKnowledgeEntry extends KnowledgeBaseEntry {
  tokens: string[];
}

interface PipelineState {
  input: string;
  context?: string;
  intent?: string;
  lastOutput?: string;
  variables: Record<string, any>;
}

@Injectable()
export class AgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentService.name);
  private model: ChatGoogleGenerativeAI;
  private agent: any;
  private conversationStore = new Map();

  private readonly defaultModelName = 'gemini-2.0-flash-exp';
  private readonly defaultMaxOutputTokens = 2048;
  private readonly defaultTemperature = 0.7;
  private readonly pipelineModelCache = new Map<string, ChatGoogleGenerativeAI>();
  private apiKey: string;
  private pipelineDefinitions: PipelineDefinition[] = [];
  private knowledgeBases: Record<string, KnowledgeBaseEntry[]> = {};
  private knowledgeBaseIndex: Record<string, IndexedKnowledgeEntry[]> = {};
  private pipelineConfigPath: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly mcpService: McpService,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing Agent Service...');
    
    // Initialize Gemini model
    this.apiKey = this.configService.get<string>('GOOGLE_API_KEY');
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY is not set in environment variables');
    }

    await this.loadPipelineConfig();

    this.model = new ChatGoogleGenerativeAI({
      apiKey: this.apiKey,
      model: this.defaultModelName,
      maxOutputTokens: this.defaultMaxOutputTokens,
      temperature: this.defaultTemperature,
    });

    // Initialize MCP and get tools
    await this.mcpService.initialize();
    const tools = await this.mcpService.getTools();

    // Create LangGraph agent
    this.agent = createReactAgent({
      llm: this.model,
      tools,
    });

    this.logger.log('Agent Service initialized successfully');
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down Agent Service...');
    await this.mcpService.cleanup();
  }

  async processQuery(queryDto: AgentQueryDto): Promise<AgentResponseDto> {
    const conversationId = uuidv4();
    const toolsUsed: string[] = [];

    try {
      // Build messages
      const messages = [
        ...(queryDto.conversationHistory || []),
        { role: 'user', content: queryDto.query },
      ];

      // Invoke agent
      const result = await this.agent.invoke({
        messages,
      });

      // Extract response
      const lastMessage = result.messages[result.messages.length - 1];
      const response = lastMessage.content;

      // Track tools used (if available in result)
      if (result.toolCalls) {
        result.toolCalls.forEach(call => toolsUsed.push(call.name));
      }

      // Store conversation
      this.conversationStore.set(conversationId, {
        messages: result.messages,
        timestamp: new Date(),
      });

      return {
        response,
        toolsUsed,
        conversationId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Error processing query:', error);
      throw error;
    }
  }

  async processQueryStream(queryDto: AgentQueryDto) {
    try {
      const messages = [
        ...(queryDto.conversationHistory || []),
        { role: 'user', content: queryDto.query },
      ];

      const stream = await this.agent.stream({
        messages,
      });

      const chunks = [];
      for await (const chunk of stream) {
        if (chunk.messages) {
          const lastMessage = chunk.messages[chunk.messages.length - 1];
          if (lastMessage.content) {
            chunks.push(lastMessage.content);
          }
        }
      }

      return {
        response: chunks.join(''),
        streaming: true,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Error processing stream query:', error);
      throw error;
    }
  }

  getConversation(conversationId: string) {
    return this.conversationStore.get(conversationId);
  }

  async runPipeline(pipelineRunDto: PipelineRunDto): Promise<PipelineRunResponseDto> {
    if (!this.pipelineDefinitions.length) {
      throw new NotFoundException('No pipelines have been configured. Please update config.json.');
    }

    const pipeline = this.pipelineDefinitions.find(
      definition =>
        definition.name === pipelineRunDto.pipelineName ||
        definition.name.toLowerCase() === pipelineRunDto.pipelineName.toLowerCase(),
    );

    if (!pipeline) {
      throw new NotFoundException(
        `Pipeline "${pipelineRunDto.pipelineName}" was not found inside ${this.pipelineConfigPath ?? 'config.json'}.`,
      );
    }

    const result = await this.executePipeline(pipeline, pipelineRunDto.input);
    return {
      pipelineName: pipeline.name,
      finalOutput: result.finalOutput,
      intent: result.intent,
      context: result.context,
      steps: result.steps,
      timestamp: new Date().toISOString(),
    };
  }

  private async executePipeline(pipeline: PipelineDefinition, userInput: string) {
    const state: PipelineState = {
      input: userInput,
      context: '',
      intent: '',
      lastOutput: '',
      variables: {},
    };

    const orderedNodeIds = this.buildExecutionOrder(pipeline);
    const steps: PipelineStepDto[] = [];

    for (const nodeId of orderedNodeIds) {
      const node = pipeline.nodes.find(n => n.id === nodeId);
      if (!node) {
        this.logger.warn(`Node "${nodeId}" was referenced in pipeline edges but not found in nodes array.`);
        continue;
      }

      let output: any;
      if (node.type === 'llm') {
        output = await this.runLlmNode(node, state);
        if (node.id.toLowerCase().includes('intent') && typeof output === 'string') {
          state.intent = output.trim();
        }
        if (!state.context) {
          state.context = typeof output === 'string' ? output : JSON.stringify(output);
        }
      } else if (node.type === 'retriever') {
        output = this.runRetrieverNode(node, state);
        if (typeof output === 'object' && output?.context) {
          state.context = output.context;
        }
      } else {
        throw new BadRequestException(`Unsupported pipeline node type "${node.type}".`);
      }

      state.lastOutput =
        typeof output === 'string'
          ? output
          : typeof output === 'object'
            ? JSON.stringify(output)
            : String(output);

      state.variables[node.id] = output;
      state.variables[node.id.toLowerCase()] = output;

      steps.push({
        nodeId: node.id,
        type: node.type,
        output,
        metadata: {
          model: node.config?.model,
          temperature: node.config?.temperature,
        },
      });
    }

    return {
      finalOutput: state.lastOutput ?? '',
      intent: state.intent,
      context: state.context,
      steps,
    };
  }

  private buildExecutionOrder(pipeline: PipelineDefinition): string[] {
    if (!pipeline.edges?.length) {
      return pipeline.nodes.map(node => node.id);
    }

    const incomingCount = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    pipeline.nodes.forEach(node => {
      incomingCount.set(node.id, 0);
      adjacency.set(node.id, []);
    });

    pipeline.edges.forEach(edge => {
      if (!incomingCount.has(edge.to)) {
        incomingCount.set(edge.to, 0);
      }
      incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);

      if (!adjacency.has(edge.from)) {
        adjacency.set(edge.from, []);
      }
      adjacency.get(edge.from)?.push(edge.to);
    });

    const queue = pipeline.nodes
      .map(node => node.id)
      .filter(id => (incomingCount.get(id) ?? 0) === 0);

    const order: string[] = [];
    while (queue.length) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      order.push(current);
      const neighbors = adjacency.get(current) ?? [];
      neighbors.forEach(neighbor => {
        const currentIncoming = incomingCount.get(neighbor) ?? 0;
        incomingCount.set(neighbor, currentIncoming - 1);
        if ((incomingCount.get(neighbor) ?? 0) === 0) {
          queue.push(neighbor);
        }
      });
    }

    if (order.length !== pipeline.nodes.length) {
      const remaining = pipeline.nodes
        .map(node => node.id)
        .filter(nodeId => !order.includes(nodeId));
      this.logger.warn(
        `Pipeline "${pipeline.name}" contains disconnected or cyclic nodes. Executing remaining nodes in declaration order.`,
      );
      order.push(...remaining);
    }

    return order;
  }

  private async runLlmNode(node: PipelineNode, state: PipelineState) {
    if (!this.model) {
      throw new Error('LLM model is not initialized');
    }

    const promptTemplate = node.config?.prompt ?? '{input}';
    const prompt = this.interpolatePrompt(promptTemplate, state);
    const temperatureOverride =
      typeof node.config?.temperature === 'number' ? node.config.temperature : undefined;
    const llm = this.getModelInstance(node.config?.model, temperatureOverride);

    const response = await (llm as any).invoke(prompt);
    const content = this.extractContentFromMessage(response).trim();
    return content;
  }

  private runRetrieverNode(node: PipelineNode, state: PipelineState) {
    const source = node.config?.source;
    if (!source) {
      throw new BadRequestException(`Retriever node "${node.id}" is missing a source configuration.`);
    }

    const knowledgeBase = this.knowledgeBaseIndex[source];
    if (!knowledgeBase?.length) {
      throw new NotFoundException(`Knowledge source "${source}" is not configured or empty.`);
    }

    const topK = typeof node.config?.top_k === 'number' ? node.config.top_k : node.config?.topK ?? 3;
    const queryContext = [state.input, state.intent, state.context]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const queryTokens = this.tokenizeText(queryContext);

    let scored = knowledgeBase
      .map(entry => ({ entry, score: this.scoreKnowledgeEntry(queryTokens, entry) }))
      .filter(({ score }) => score > 0 || !queryTokens.length)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    if (!scored.length && knowledgeBase.length) {
      scored = knowledgeBase
        .map(entry => ({ entry, score: 0 }))
        .slice(0, Math.min(topK, knowledgeBase.length));
    }

    const context =
      scored.length > 0
        ? scored
            .map(
              ({ entry }, index) =>
                `Snippet ${index + 1} - ${entry.title}
Summary: ${entry.summary ?? 'n/a'}
${entry.content}`,
            )
            .join('\n\n')
        : 'No relevant knowledge found in the configured knowledge base.';

    return {
      source,
      matches: scored.map(({ entry, score }, index) => ({
        rank: index + 1,
        id: entry.id,
        title: entry.title,
        content: entry.content,
        summary: entry.summary,
        tags: entry.tags,
        keywords: entry.keywords,
        score,
      })),
      context,
    };
  }

  private interpolatePrompt(template: string, state: PipelineState): string {
    return template.replace(/\{(.*?)\}/g, (_, token) => {
      const value = this.resolveTemplateToken(token?.trim(), state);
      return value ?? '';
    });
  }

  private resolveTemplateToken(token: string, state: PipelineState): string {
    if (!token) {
      return '';
    }

    const normalized = token.toLowerCase();
    if (normalized === 'input') {
      return state.input;
    }
    if (normalized === 'context') {
      return state.context ?? '';
    }
    if (normalized === 'intent') {
      return state.intent ?? '';
    }
    if (normalized === 'last_output') {
      return state.lastOutput ?? '';
    }

    const directValue = state.variables[token] ?? state.variables[normalized];
    if (directValue === undefined || directValue === null) {
      return '';
    }
    if (typeof directValue === 'string') {
      return directValue;
    }
    if (typeof directValue === 'object') {
      return JSON.stringify(directValue);
    }
    return String(directValue);
  }

  private extractContentFromMessage(response: any): string {
    if (!response) {
      return '';
    }

    if (typeof response === 'string') {
      return response;
    }

    if (response.content) {
      if (typeof response.content === 'string') {
        return response.content;
      }
      if (Array.isArray(response.content)) {
        return response.content
          .map(block => {
            if (typeof block === 'string') {
              return block;
            }
            if (block?.text) {
              return block.text;
            }
            if (typeof block?.content === 'string') {
              return block.content;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }
    }

    if (response.text) {
      return response.text;
    }

    return JSON.stringify(response);
  }

  private getModelInstance(modelName?: string, temperature?: number) {
    const normalizedModel = modelName ?? this.defaultModelName;
    if (normalizedModel !== this.defaultModelName) {
      this.logger.warn(
        `Model "${normalizedModel}" requested by pipeline but only Google Gemini (${this.defaultModelName}) is configured. Falling back.`,
      );
    }

    if (typeof temperature === 'number' && temperature !== this.defaultTemperature) {
      const cacheKey = `${this.defaultModelName}:${temperature}`;
      if (!this.pipelineModelCache.has(cacheKey)) {
        this.pipelineModelCache.set(
          cacheKey,
          new ChatGoogleGenerativeAI({
            apiKey: this.apiKey,
            model: this.defaultModelName,
            maxOutputTokens: this.defaultMaxOutputTokens,
            temperature,
          }),
        );
      }
      return this.pipelineModelCache.get(cacheKey) as ChatGoogleGenerativeAI;
    }

    return this.model;
  }

  private async loadPipelineConfig() {
    const configuredPath = this.configService.get<string>('PIPELINE_CONFIG_PATH');
    this.pipelineConfigPath = configuredPath
      ? path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(process.cwd(), configuredPath)
      : path.resolve(process.cwd(), 'config.json');

    try {
      const raw = await fs.readFile(this.pipelineConfigPath, 'utf-8');
      if (!raw.trim()) {
        this.logger.warn(`Pipeline config file at ${this.pipelineConfigPath} is empty.`);
        this.pipelineDefinitions = [];
        this.knowledgeBases = {};
        return;
      }

      const parsed = JSON.parse(raw);
      this.pipelineDefinitions = Array.isArray(parsed.pipelines) ? parsed.pipelines : [];
      this.knowledgeBases =
        parsed.knowledgeBases && typeof parsed.knowledgeBases === 'object'
          ? parsed.knowledgeBases
          : {};
      this.knowledgeBaseIndex = this.buildKnowledgeBaseIndex(this.knowledgeBases);

      this.logger.log(
        `Loaded ${this.pipelineDefinitions.length} pipeline(s) from ${this.pipelineConfigPath}`,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.warn(
          `Pipeline config file ${this.pipelineConfigPath} was not found. Workflow execution is disabled until it is created.`,
        );
      } else {
        this.logger.error(
          `Failed to read pipeline configuration from ${this.pipelineConfigPath}`,
          error as Error,
        );
      }
      this.pipelineDefinitions = [];
      this.knowledgeBases = {};
      this.knowledgeBaseIndex = {};
    }
  }

  private buildKnowledgeBaseIndex(sources: Record<string, KnowledgeBaseEntry[]>) {
    return Object.entries(sources).reduce<Record<string, IndexedKnowledgeEntry[]>>(
      (acc, [source, entries]) => {
        acc[source] = entries.map(entry => ({
          ...entry,
          tokens: this.tokenizeKnowledgeEntry(entry),
        }));
        return acc;
      },
      {},
    );
  }

  private tokenizeKnowledgeEntry(entry: KnowledgeBaseEntry): string[] {
    const bucket = [
      entry.title,
      entry.summary,
      entry.content,
      ...(entry.tags ?? []),
      ...(entry.keywords ?? []),
    ]
      .filter(Boolean)
      .join(' ');

    const tokens = this.tokenizeText(bucket);
    return Array.from(new Set(tokens));
  }

  private tokenizeText(text?: string): string[] {
    if (!text) {
      return [];
    }
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  private scoreKnowledgeEntry(queryTokens: string[], entry: IndexedKnowledgeEntry) {
    if (!entry.tokens.length) {
      return 0;
    }

    const overlap = queryTokens.reduce(
      (sum, token) => sum + (entry.tokens.includes(token) ? 1 : 0),
      0,
    );

    if (!overlap && queryTokens.length) {
      return 0;
    }

    const priority = entry.priority ?? entry.weight ?? 1;
    const lengthPenalty = Math.log(entry.tokens.length + 1) + 1;
    return (overlap + 0.1 * (entry.tags?.length ?? 0)) * priority / lengthPenalty;
  }
}
