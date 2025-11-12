import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { McpService } from './mcp.service';

@ApiTags('mcp')
@Controller('mcp')
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @Get('tools')
  @ApiOperation({ summary: 'List all available MCP tools' })
  async listTools() {
    return this.mcpService.listAvailableTools();
  }

  @Get('health')
  @ApiOperation({ summary: 'Check MCP service health' })
  async health() {
    const tools = await this.mcpService.listAvailableTools();
    return {
      status: 'ok',
      toolCount: tools.length,
      timestamp: new Date().toISOString(),
    };
  }
}
