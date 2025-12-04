import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChatGoogleGenerativeAI,
  GoogleGenerativeAIEmbeddings,
} from '@langchain/google-genai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { McpService } from '../mcp/mcp.service';
import { AgentQueryDto, AgentResponseDto } from './dto/agent-query.dto';
import {
  PipelineRunDto,
  PipelineRunResponseDto,
  PipelineStepDto,
} from './dto/pipeline-run.dto';
import {
  KnowledgeBaseEntry,
  IndexedKnowledgeEntry,
  KnowledgeBaseIndexer,
} from './knowledge-base-indexer';
import { VectorStoreService } from './vector-store.service';
import { ChatHistoryService, ChatMessageRecord } from './chat-history.service';
import { ProductApiService } from '../mocks/product-api.service';
import { LocationApiService } from '../mocks/location-api.service';
import * as fs from 'fs/promises';
import * as path from 'path';

type PipelineNodeType = 'llm' | 'retriever' | 'tool';

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

  private readonly defaultModelName = 'gemini-2.5-flash';
  private readonly defaultMaxOutputTokens = 2048;
  private readonly defaultTemperature = 0.7;
  private readonly pipelineModelCache = new Map<string, ChatGoogleGenerativeAI>();
  private apiKey: string;
  private pipelineDefinitions: PipelineDefinition[] = [];
  private knowledgeBases: Record<string, KnowledgeBaseEntry[]> = {};
  private knowledgeBaseIndex: Record<string, IndexedKnowledgeEntry[]> = {};
  private pipelineConfigPath: string;
  private embeddingsModel: GoogleGenerativeAIEmbeddings;
  private readonly defaultEmbeddingModelName = 'text-embedding-004';
  private readonly knowledgeBaseIndexer = new KnowledgeBaseIndexer();
  private readonly productApiService = new ProductApiService();
  private readonly locationApiService = new LocationApiService();

  constructor(
    private readonly configService: ConfigService,
    private readonly mcpService: McpService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly chatHistoryService: ChatHistoryService,
  ) { }

  async onModuleInit() {
    this.logger.log('Initializing Agent Service...');

    // Initialize Gemini model and embeddings
    this.apiKey = this.configService.get<string>('GOOGLE_API_KEY');
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY is not set in environment variables');
    }

    this.model = new ChatGoogleGenerativeAI({
      apiKey: this.apiKey,
      model: this.defaultModelName,
      maxOutputTokens: this.defaultMaxOutputTokens,
      temperature: this.defaultTemperature,
    });
    this.embeddingsModel = new GoogleGenerativeAIEmbeddings({
      apiKey: this.apiKey,
      modelName: this.defaultEmbeddingModelName,
    });

    await this.vectorStoreService.initialize();
    await this.chatHistoryService.initialize();
    await this.loadPipelineConfig();

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
    const toolsUsed: string[] = [];

    try {
      // If pipelines are configured, use the first one (default behavior for this client)
      if (this.pipelineDefinitions.length > 0) {
        const pipeline = this.pipelineDefinitions[0];
        const result = await this.executePipeline(pipeline, queryDto.query);

        // Save to history
        const { conversationId, history } = await this.resolveConversationHistory(queryDto);

        if (conversationId) {
          await this.chatHistoryService.appendMessage(conversationId, 'user', queryDto.query, {
            customerId: queryDto.customerId,
          });

          await this.chatHistoryService.appendMessage(conversationId, 'assistant', result.finalOutput, {
            toolsUsed: result.steps.map(s => s.nodeId),
            pipelineName: pipeline.name,
          });
        }

        return {
          response: result.finalOutput,
          toolsUsed: result.steps.map(s => s.nodeId),
          conversationId,
          timestamp: new Date().toISOString(),
        };
      }

      // Fallback to default LangGraph agent
      const { conversationId, history } = await this.resolveConversationHistory(queryDto);
      const messages = [...history, { role: 'user', content: queryDto.query }];

      if (conversationId) {
        await this.chatHistoryService.appendMessage(conversationId, 'user', queryDto.query, {
          customerId: queryDto.customerId,
        });
      }

      const result = await this.agent.invoke({
        messages,
      });

      const lastMessage = result.messages[result.messages.length - 1];
      const response = this.extractContentFromMessage(lastMessage?.content ?? lastMessage);

      if (result.toolCalls) {
        result.toolCalls.forEach(call => toolsUsed.push(call.name));
      }

      if (conversationId && response) {
        await this.chatHistoryService.appendMessage(conversationId, 'assistant', response, {
          toolsUsed,
        });
      }

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
      const { conversationId, history } = await this.resolveConversationHistory(queryDto);
      const messages = [...history, { role: 'user', content: queryDto.query }];

      if (conversationId) {
        await this.chatHistoryService.appendMessage(conversationId, 'user', queryDto.query, {
          customerId: queryDto.customerId,
        });
      }

      const stream = await this.agent.stream({
        messages,
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.messages?.length) {
          const lastMessage = chunk.messages[chunk.messages.length - 1];
          const content = this.extractContentFromMessage(
            lastMessage?.content ?? lastMessage,
          );
          if (content) {
            chunks.push(content);
          }
        }
      }

      const response = chunks.join('');

      if (conversationId && response) {
        await this.chatHistoryService.appendMessage(conversationId, 'assistant', response);
      }

      return {
        response,
        streaming: true,
        conversationId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Error processing stream query:', error);
      throw error;
    }
  }

  async getConversation(conversationId: string) {
    return this.chatHistoryService.getConversation(conversationId);
  }

  async listConversations(limit?: number) {
    return this.chatHistoryService.listConversations(limit);
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

  private async resolveConversationHistory(
    queryDto: AgentQueryDto,
  ): Promise<{ conversationId: string; history: Array<{ role: string; content: string }> }> {
    let conversationId = queryDto.conversationId;
    let history: Array<{ role: string; content: string }> = queryDto.conversationHistory ?? [];

    if (conversationId) {
      const stored = await this.chatHistoryService.getConversation(conversationId);
      if (stored?.messages?.length) {
        history = this.convertStoredMessagesToHistory(stored.messages);
      }
    } else {
      const created = await this.chatHistoryService.createConversation(
        queryDto.subject,
        queryDto.customerId,
        queryDto.metadata,
      );
      conversationId = created.id;
    }

    if (!conversationId) {
      throw new Error('Failed to resolve or create a conversation ID for chat history');
    }

    return { conversationId, history };
  }

  private convertStoredMessagesToHistory(
    messages: ChatMessageRecord[],
  ): Array<{ role: string; content: string }> {
    if (!messages?.length) {
      return [];
    }

    return messages.map(message => ({
      role: message.role,
      content: message.content ?? '',
    }));
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
        output = await this.runRetrieverNode(node, state);
        if (typeof output === 'object' && output?.context) {
          state.context = output.context;
        }
      } else if (node.type === 'tool') {
        output = await this.runToolNode(node, state);
        if (typeof output === 'string' || (typeof output === 'object' && output !== null)) {
          // Append tool output to context if it's relevant
          const toolOutputStr = typeof output === 'string' ? output : JSON.stringify(output);
          state.context = state.context ? `${state.context}\n\nTool Output (${node.id}): ${toolOutputStr}` : `Tool Output (${node.id}): ${toolOutputStr}`;
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

  private async runRetrieverNode(node: PipelineNode, state: PipelineState) {
    const source = node.config?.source;
    if (!source) {
      throw new BadRequestException(
        `Retriever node "${node.id}" is missing a source configuration.`,
      );
    }

    const knowledgeBase = this.knowledgeBaseIndex[source];
    if (!knowledgeBase?.length) {
      throw new NotFoundException(`Knowledge source "${source}" is not configured or empty.`);
    }

    const topK = typeof node.config?.top_k === 'number' ? node.config.top_k : node.config?.topK ?? 3;
    const queryContext = [state.input, state.intent].filter(Boolean).join(' ').toLowerCase();
    const queryTokens = this.tokenizeText(queryContext);
    const queryEmbedding = await this.generateQueryEmbedding(state);

    const vectorResults = queryEmbedding
      ? await this.vectorStoreService.semanticSearch(source, queryEmbedding, topK)
      : [];

    if (vectorResults.length) {
      const context = vectorResults
        .map(
          ({ title, content, metadata }, index) =>
            `Snippet ${index + 1} - ${title}
Summary: ${metadata?.summary ?? 'n/a'}
${content}`,
        )
        .join('\n\n');

      return {
        source,
        matches: vectorResults.map((result, index) => ({
          rank: index + 1,
          id: result.id,
          title: result.title,
          content: result.content,
          summary: result.metadata?.summary,
          tags: result.metadata?.tags,
          keywords: result.metadata?.keywords,
          score: result.score,
        })),
        context,
      };
    }

    let scored = knowledgeBase
      .map(entry => ({
        entry,
        score: this.scoreKnowledgeEntry(queryTokens, entry, queryEmbedding),
      }))
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

  private async runToolNode(node: PipelineNode, state: PipelineState) {
    const toolName = node.config?.toolName;
    if (!toolName) {
      throw new BadRequestException(`Tool node "${node.id}" is missing 'toolName' config.`);
    }

    if (toolName === 'mock_product_api') {
      const query = (state.input + ' ' + (state.intent || '')).toLowerCase();
      return this.productApiService.searchProducts(query);
    }

    if (toolName === 'mock_location_api') {
      const query = (state.input + ' ' + (state.intent || '')).toLowerCase();
      return this.locationApiService.searchLocations(query);
    }

    throw new BadRequestException(`Unknown tool name "${toolName}" requested by node "${node.id}".`);
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
        `Model "${normalizedModel}" requested by pipeline but only Google Gemini(${this.defaultModelName}) is configured.Falling back.`,
      );
    }

    if (typeof temperature === 'number' && temperature !== this.defaultTemperature) {
      const cacheKey = `${this.defaultModelName}: ${temperature}`;
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
      : path.resolve(process.cwd(), 'config/config.json');

    try {
      const raw = await fs.readFile(this.pipelineConfigPath, 'utf-8');
      if (!raw.trim()) {
        this.logger.warn(`Pipeline config file at ${this.pipelineConfigPath} is empty.`);
        this.pipelineDefinitions = [];
        this.knowledgeBases = {};
        this.knowledgeBaseIndex = {};
        return;
      }

      const parsed = JSON.parse(raw);
      this.pipelineDefinitions = Array.isArray(parsed.pipelines) ? parsed.pipelines : [];
      this.knowledgeBases =
        parsed.knowledgeBases && typeof parsed.knowledgeBases === 'object'
          ? parsed.knowledgeBases
          : {};
      this.logger.log('Building knowledge base index...');
      this.knowledgeBaseIndex = await this.knowledgeBaseIndexer.buildIndex(
        this.knowledgeBases,
        this.embeddingsModel,
      );
      this.logger.log('Knowledge base index built. Syncing sources...');
      await this.vectorStoreService.syncSources(this.knowledgeBaseIndex);

      this.logger.log(
        `Loaded ${this.pipelineDefinitions.length} pipeline(s) from ${this.pipelineConfigPath}`,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.warn(
          `Pipeline config file ${this.pipelineConfigPath} was not found.Workflow execution is disabled until it is created.`,
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

  private tokenizeText(text?: string): string[] {
    if (!text) {
      return [];
    }
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  private async generateQueryEmbedding(state: PipelineState) {
    const query = [state.input, state.intent].filter(Boolean).join('\n');
    return this.embedText(query, 'retriever-query');
  }

  private async embedText(text?: string, label?: string) {
    if (!text?.trim() || !this.embeddingsModel) {
      return undefined;
    }

    try {
      return await this.embeddingsModel.embedQuery(text);
    } catch (error) {
      this.logger.warn(
        `Vectorization failed${label ? ` for ${label}` : ''}: ${(error as Error).message} `,
      );
      return undefined;
    }
  }

  private scoreKnowledgeEntry(
    queryTokens: string[],
    entry: IndexedKnowledgeEntry,
    queryEmbedding?: number[],
  ) {
    const lexicalScore = this.calculateLexicalScore(queryTokens, entry);
    if (queryEmbedding && entry.embedding?.length === queryEmbedding.length) {
      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
      const priority = entry.priority ?? entry.weight ?? 1;
      return similarity * priority + lexicalScore * 0.25;
    }
    return lexicalScore;
  }

  private calculateLexicalScore(queryTokens: string[], entry: IndexedKnowledgeEntry) {
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
    return ((overlap + 0.1 * (entry.tags?.length ?? 0)) * priority) / lengthPenalty;
  }

  private cosineSimilarity(a: number[], b: number[]) {
    if (!a.length || !b.length || a.length !== b.length) {
      return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (!normA || !normB) {
      return 0;
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
