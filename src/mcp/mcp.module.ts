import { Module } from '@nestjs/common';
import { McpService } from './mcp.service';
import { McpController } from './mcp.controller';

@Module({
  providers: [McpService],
  controllers: [McpController],
  exports: [McpService],
})
export class McpModule {}