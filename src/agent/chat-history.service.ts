import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

type PgPoolClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
  release: () => void;
};

type PgPool = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
  connect: () => Promise<PgPoolClient>;
  end: () => Promise<void>;
};

type PgModule = {
  Pool: new (config: Record<string, any>) => PgPool;
};

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface ChatConversationRecord {
  id: string;
  subject?: string;
  customerId?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  lastMessageAt?: string;
  messages?: ChatMessageRecord[];
}

@Injectable()
export class ChatHistoryService implements OnModuleDestroy {
  private readonly logger = new Logger(ChatHistoryService.name);
  private pool?: PgPool;
  private enabled = false;
  private pgModule?: PgModule;

  private readonly memoryConversations = new Map<
    string,
    Omit<ChatConversationRecord, 'messages'> & { messages: ChatMessageRecord[] }
  >();

  constructor(private readonly configService: ConfigService) {}

  async initialize() {
    if (this.enabled) {
      return;
    }
    await this.initializePostgres();
  }

  async onModuleDestroy() {
    await this.disposePool();
  }

  isEnabled() {
    return this.enabled && !!this.pool;
  }

  async createConversation(
    subject?: string,
    customerId?: string,
    metadata?: Record<string, any>,
  ): Promise<ChatConversationRecord> {
    if (!this.isEnabled()) {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      this.memoryConversations.set(id, {
        id,
        subject,
        customerId,
        metadata,
        createdAt,
        lastMessageAt: createdAt,
        messages: [],
      });
      return { id, subject, customerId, metadata, createdAt, lastMessageAt: createdAt };
    }

    if (!this.pool) {
      throw new Error('Chat history database has not been initialized');
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO customer_conversations (id, subject, customer_id, metadata, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)`,
      [id, subject ?? null, customerId ?? null, metadata ? JSON.stringify(metadata) : null, createdAt],
    );

    return { id, subject, customerId, metadata, createdAt, lastMessageAt: createdAt };
  }

  async appendMessage(
    conversationId: string,
    role: ChatRole,
    content: string,
    metadata?: Record<string, any>,
  ): Promise<ChatMessageRecord> {
    if (!conversationId) {
      throw new Error('Conversation ID is required to append messages');
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();

    if (!this.isEnabled()) {
      const convo = this.memoryConversations.get(conversationId);
      if (!convo) {
        throw new Error(`Conversation ${conversationId} does not exist in memory`);
      }
      const message: ChatMessageRecord = {
        id,
        conversationId,
        role,
        content,
        metadata,
        createdAt,
      };
      convo.messages.push(message);
      convo.lastMessageAt = createdAt;
      return message;
    }

    if (!this.pool) {
      throw new Error('Chat history database has not been initialized');
    }

    await this.pool.query(
      `INSERT INTO customer_messages (id, conversation_id, role, content, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)`,
      [id, conversationId, role, content, metadata ? JSON.stringify(metadata) : null, createdAt],
    );

    await this.pool.query(
      `UPDATE customer_conversations
       SET last_message_at = GREATEST(COALESCE(last_message_at, $2::timestamptz), $2::timestamptz)
       WHERE id = $1`,
      [conversationId, createdAt],
    );

    return { id, conversationId, role, content, metadata, createdAt };
  }

  async getConversation(conversationId: string): Promise<ChatConversationRecord | null> {
    if (!conversationId) {
      return null;
    }

    if (!this.isEnabled()) {
      const convo = this.memoryConversations.get(conversationId);
      if (!convo) {
        return null;
      }
      return {
        id: convo.id,
        subject: convo.subject,
        customerId: convo.customerId,
        metadata: convo.metadata,
        createdAt: convo.createdAt,
        lastMessageAt: convo.lastMessageAt,
        messages: [...convo.messages],
      };
    }

    if (!this.pool) {
      throw new Error('Chat history database has not been initialized');
    }

    const { rows } = await this.pool.query(
      `SELECT id, subject, customer_id, metadata, created_at, last_message_at
       FROM customer_conversations
       WHERE id = $1`,
      [conversationId],
    );

    if (!rows.length) {
      return null;
    }

    const convoRow = rows[0];
    const messages = await this.getMessages(conversationId);

    return {
      id: convoRow.id,
      subject: convoRow.subject ?? undefined,
      customerId: convoRow.customer_id ?? undefined,
      metadata: convoRow.metadata ?? undefined,
      createdAt: convoRow.created_at?.toISOString
        ? convoRow.created_at.toISOString()
        : convoRow.created_at,
      lastMessageAt: convoRow.last_message_at?.toISOString
        ? convoRow.last_message_at.toISOString()
        : convoRow.last_message_at,
      messages,
    };
  }

  async listConversations(limit = 25): Promise<ChatConversationRecord[]> {
    if (!this.isEnabled()) {
      return Array.from(this.memoryConversations.values())
        .sort((a, b) => (a.lastMessageAt ?? '').localeCompare(b.lastMessageAt ?? ''))
        .reverse()
        .slice(0, limit)
        .map(convo => ({
          id: convo.id,
          subject: convo.subject,
          customerId: convo.customerId,
          metadata: convo.metadata,
          createdAt: convo.createdAt,
          lastMessageAt: convo.lastMessageAt,
        }));
    }

    if (!this.pool) {
      throw new Error('Chat history database has not been initialized');
    }

    const { rows } = await this.pool.query(
      `SELECT id, subject, customer_id, metadata, created_at, last_message_at
       FROM customer_conversations
       ORDER BY COALESCE(last_message_at, created_at) DESC
       LIMIT $1`,
      [limit],
    );

    return rows.map(row => ({
      id: row.id,
      subject: row.subject ?? undefined,
      customerId: row.customer_id ?? undefined,
      metadata: row.metadata ?? undefined,
      createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at,
      lastMessageAt: row.last_message_at?.toISOString
        ? row.last_message_at.toISOString()
        : row.last_message_at,
    }));
  }

  async getMessages(conversationId: string): Promise<ChatMessageRecord[]> {
    if (!conversationId) {
      return [];
    }

    if (!this.isEnabled()) {
      const convo = this.memoryConversations.get(conversationId);
      return convo ? [...convo.messages] : [];
    }

    if (!this.pool) {
      throw new Error('Chat history database has not been initialized');
    }

    const { rows } = await this.pool.query(
      `SELECT id, conversation_id, role, content, metadata, created_at
       FROM customer_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [conversationId],
    );

    return rows.map(row => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      metadata: row.metadata ?? undefined,
      createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at,
    }));
  }

  private async initializePostgres() {
    const pg = await this.ensurePgModule();
    if (!pg) {
      return;
    }

    const connectionString =
      this.configService.get<string>('CHAT_DB_URL') ??
      this.configService.get<string>('DATABASE_URL');

    if (!connectionString) {
      this.logger.warn(
        'Chat history persistence disabled (set CHAT_DB_URL or DATABASE_URL to enable storage).',
      );
      return;
    }

    try {
      this.pool = new pg.Pool({ connectionString });
      await this.ensureSchema();
      this.enabled = true;
      this.logger.log('Chat history service connected to PostgreSQL.');
    } catch (error) {
      this.logger.error('Failed to initialize chat history database', error as Error);
      await this.disposePool();
    }
  }

  private async ensureSchema() {
    if (!this.pool) {
      return;
    }

    for (const statement of this.buildSchemaStatements()) {
      await this.pool.query(statement);
    }
  }

  private async disposePool() {
    if (this.pool) {
      await this.pool.end();
      this.pool = undefined;
    }
    this.enabled = false;
  }

  private async ensurePgModule(): Promise<PgModule | null> {
    if (this.pgModule) {
      return this.pgModule;
    }

    try {
      const pg = await import('pg');
      this.pgModule = pg as PgModule;
      return this.pgModule;
    } catch (error) {
      this.logger.warn(
        'PostgreSQL driver "pg" is not installed; chat history storage will remain disabled until it is added.',
      );
      return null;
    }
  }

  private buildSchemaStatements(): string[] {
    const statements: string[] = [
      `
        CREATE TABLE IF NOT EXISTS customer_conversations (
          id uuid PRIMARY KEY,
          subject text,
          customer_id text,
          metadata jsonb,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          last_message_at timestamptz
        );
      `,
      `
        CREATE TABLE IF NOT EXISTS customer_messages (
          id uuid PRIMARY KEY,
          conversation_id uuid NOT NULL REFERENCES customer_conversations(id) ON DELETE CASCADE,
          role text NOT NULL,
          content text NOT NULL,
          metadata jsonb,
          created_at timestamptz NOT NULL DEFAULT NOW()
        );
      `,
      `
        CREATE INDEX IF NOT EXISTS idx_customer_messages_conversation_id
        ON customer_messages(conversation_id);
      `,
      `
        CREATE INDEX IF NOT EXISTS idx_customer_conversations_last_message
        ON customer_conversations(COALESCE(last_message_at, created_at));
      `,
    ];

    return statements.map(statement => statement.trim()).filter(Boolean);
  }
}
