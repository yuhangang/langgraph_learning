import { Logger } from '@nestjs/common';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';

export interface KnowledgeBaseEntry {
  id?: string;
  title: string;
  content: string;
  summary?: string;
  tags?: string[];
  keywords?: string[];
  priority?: number;
  weight?: number;
}

export interface IndexedKnowledgeEntry extends KnowledgeBaseEntry {
  tokens: string[];
  embedding?: number[];
}

export class KnowledgeBaseIndexer {
  private readonly logger = new Logger(KnowledgeBaseIndexer.name);

  async buildIndex(
    sources: Record<string, KnowledgeBaseEntry[]>,
    embeddings?: GoogleGenerativeAIEmbeddings,
  ): Promise<Record<string, IndexedKnowledgeEntry[]>> {
    if (!sources || !Object.keys(sources).length) {
      return {};
    }

    const indexedSources = await Promise.all(
      Object.entries(sources).map(async ([source, entries]) => {
        const normalizedEntries = Array.isArray(entries) ? entries : [];
        const enrichedEntries = await Promise.all(
          normalizedEntries.map(entry => this.enrichEntry(entry, embeddings)),
        );
        return [source, enrichedEntries] as [string, IndexedKnowledgeEntry[]];
      }),
    );

    return indexedSources.reduce<Record<string, IndexedKnowledgeEntry[]>>(
      (acc, [source, entries]) => {
        acc[source] = entries;
        return acc;
      },
      {},
    );
  }

  private async enrichEntry(
    entry: KnowledgeBaseEntry,
    embeddings?: GoogleGenerativeAIEmbeddings,
  ): Promise<IndexedKnowledgeEntry> {
    this.logger.log(`Enriching entry: ${entry.id ?? entry.title}`);
    return {
      ...entry,
      tokens: this.tokenizeEntry(entry),
      embedding: await this.embedEntry(entry, embeddings),
    };
  }

  private tokenizeEntry(entry: KnowledgeBaseEntry) {
    const bucket = [
      entry.title,
      entry.summary,
      entry.content,
      ...(entry.tags ?? []),
      ...(entry.keywords ?? []),
    ]
      .filter(Boolean)
      .join(' ');

    return Array.from(
      new Set(
        bucket
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean),
      ),
    );
  }

  private async embedEntry(
    entry: KnowledgeBaseEntry,
    embeddings?: GoogleGenerativeAIEmbeddings,
  ) {
    if (!embeddings) {
      return undefined;
    }

    const text = [
      entry.title,
      entry.summary,
      entry.content,
      ...(entry.tags ?? []),
      ...(entry.keywords ?? []),
    ]
      .filter(Boolean)
      .join('\n');

    if (!text.trim()) {
      return undefined;
    }

    try {
      this.logger.log(`Embedding entry: ${entry.id ?? entry.title}`);
      const result = await embeddings.embedQuery(text);
      this.logger.log(`Embedded entry: ${entry.id ?? entry.title}`);
      return result;
    } catch (error) {
      this.logger.warn(
        `Vectorization failed for ${entry.id ?? entry.title ?? 'knowledge-entry'}: ${(error as Error).message
        }`,
      );
      return undefined;
    }
  }
}
