import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IndexedKnowledgeEntry } from './knowledge-base-indexer';

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

export interface VectorSearchResult {
  id: string;
  title: string;
  content: string;
  metadata?: Record<string, any>;
  score: number;
}

@Injectable()
export class VectorStoreService implements OnModuleDestroy {
  private readonly logger = new Logger(VectorStoreService.name);
  private pool?: PgPool;
  private enabled = false;
  private readonly embeddingDimensions = 768;
  private pgModule?: PgModule;

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

  async syncSources(index: Record<string, IndexedKnowledgeEntry[]>) {
    if (!this.isEnabled() || !Object.keys(index ?? {}).length) {
      return;
    }

    for (const [source, entries] of Object.entries(index)) {
      await this.syncSource(source, entries);
    }
  }

  async semanticSearch(
    source: string,
    embedding: number[],
    topK: number,
  ): Promise<VectorSearchResult[]> {
    if (!this.isEnabled() || !embedding?.length || !this.pool) {
      return [];
    }

    try {
      const { rows } = await this.pool.query(
        `SELECT entry_id, title, content, metadata,
                1 - (embedding <=> $3::vector) AS score
         FROM knowledge_vectors
         WHERE source = $1
         ORDER BY embedding <=> $3::vector ASC
         LIMIT $2`,
        [source, topK, this.toVectorLiteral(embedding)],
      );

      return rows.map(row => ({
        id: row.entry_id,
        title: row.title,
        content: row.content,
        metadata: row.metadata ?? undefined,
        score: typeof row.score === 'number' ? row.score : Number(row.score ?? 0),
      }));
    } catch (error) {
      this.logger.error('Vector similarity search failed', error as Error);
      return [];
    }
  }

  private async syncSource(source: string, entries: IndexedKnowledgeEntry[]) {
    if (!entries.length || !this.pool) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM knowledge_vectors WHERE source = $1', [source]);

      for (const entry of entries) {
        if (!entry.embedding?.length) {
          continue;
        }

        const metadata = {
          summary: entry.summary,
          tags: entry.tags,
          keywords: entry.keywords,
          priority: entry.priority ?? entry.weight,
        };

        await client.query(
          `INSERT INTO knowledge_vectors (source, entry_id, title, content, metadata, embedding)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector)`,
          [
            source,
            entry.id ?? entry.title,
            entry.title,
            entry.content,
            JSON.stringify(metadata),
            this.toVectorLiteral(entry.embedding),
          ],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(
        `Failed to sync vector store for source "${source}"`,
        error as Error,
      );
    } finally {
      client.release();
    }
  }

  private async initializePostgres() {
    const pg = await this.ensurePgModule();
    if (!pg) {
      return;
    }

    const connectionString =
      this.configService.get<string>('VECTOR_DB_URL') ??
      this.configService.get<string>('DATABASE_URL');

    if (!connectionString) {
      this.logger.warn(
        'Vector store disabled (set VECTOR_DB_URL or DATABASE_URL to enable PostgreSQL storage).',
      );
      return;
    }

    try {
      this.pool = new pg.Pool({ connectionString });
      await this.ensurePostgresSchema();
      this.enabled = true;
      this.logger.log('Vector store connected to PostgreSQL.');
    } catch (error) {
      this.logger.error('Failed to initialize vector store', error as Error);
      await this.disposePool();
    }
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
        'PostgreSQL driver "pg" is not installed; vector storage will remain disabled until it is added.',
      );
      return null;
    }
  }

  private async ensurePostgresSchema() {
    if (!this.pool) {
      return;
    }

    await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS knowledge_vectors (
        source text NOT NULL,
        entry_id text NOT NULL,
        title text NOT NULL,
        content text NOT NULL,
        metadata jsonb,
        embedding vector(${this.embeddingDimensions}),
        PRIMARY KEY (source, entry_id)
      );
    `);
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_source ON knowledge_vectors(source);',
    );
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_embedding
      ON knowledge_vectors USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    `);
  }

  private async disposePool() {
    if (this.pool) {
      await this.pool.end();
      this.pool = undefined;
    }
    this.enabled = false;
  }

  private toVectorLiteral(values: number[]) {
    return `[${values.join(',')}]`;
  }
}
