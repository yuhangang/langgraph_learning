import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createRequire } from 'module';
import * as path from 'path';

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);
  private mcpClient?: MultiServerMCPClient;
  private tools: any[] = [];
  private readonly nodeRequire = createRequire(__filename);

  constructor(private readonly configService: ConfigService) {}

  async initialize() {
    this.logger.log('Initializing MCP Service...');

    const mcpServers: Record<string, { transport: 'stdio'; command: string; args: string[] }> = {};

    const mathServer = this.getMathServerConfig();
    if (mathServer) {
      mcpServers.math = mathServer;
    } else {
      this.logger.warn(
        'Math MCP server package not found locally. Install @modelcontextprotocol/server-math to enable math tools.',
      );
    }

    if (Object.keys(mcpServers).length === 0) {
      this.logger.warn('No MCP servers configured. Continuing without MCP tools.');
      this.tools = [];
      this.mcpClient = undefined;
      return;
    }

    // Initialize MultiServerMCPClient
    this.mcpClient = new MultiServerMCPClient({
      throwOnLoadError: false,
      prefixToolNameWithServerName: true,
      useStandardContentBlocks: true,
      mcpServers,
    });

    try {
      // Load tools from all MCP servers
      this.tools = await this.mcpClient.getTools();
      this.logger.log(`Loaded ${this.tools.length} tools from MCP servers`);

      // Log available tools
      this.tools.forEach(tool => {
        this.logger.log(`Tool available: ${tool.name}`);
      });
    } catch (error) {
      this.logger.error('Failed to load tools from MCP servers', error as Error);
      this.tools = [];
    }
  }

  async getTools() {
    return this.tools;
  }

  async listAvailableTools() {
    return this.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
    }));
  }

  async cleanup() {
    if (this.mcpClient) {
      await this.mcpClient.close();
      this.logger.log('MCP Client closed');
    }
  }

  private getMathServerConfig():
    | { transport: 'stdio'; command: string; args: string[] }
    | undefined {
    try {
      const packageJsonPath = this.nodeRequire.resolve(
        '@modelcontextprotocol/server-math/package.json',
      );
      const packageDir = path.dirname(packageJsonPath);
      const packageJson = this.nodeRequire(packageJsonPath) as {
        bin?: string | Record<string, string>;
      };

      let binRelative: string | undefined;
      if (typeof packageJson.bin === 'string') {
        binRelative = packageJson.bin;
      } else if (packageJson.bin && typeof packageJson.bin === 'object') {
        binRelative = packageJson.bin['server-math'] ?? Object.values(packageJson.bin)[0];
      }

      if (!binRelative) {
        this.logger.warn(
          'Could not determine executable for @modelcontextprotocol/server-math. Skipping math MCP server.',
        );
        return undefined;
      }

      const mathServerEntry = path.resolve(packageDir, binRelative);
      return {
        transport: 'stdio',
        command: process.execPath,
        args: [mathServerEntry],
      };
    } catch (error) {
      return undefined;
    }
  }
}
