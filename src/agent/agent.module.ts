import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { McpModule } from '../mcp/mcp.module';
import { VectorStoreService } from './vector-store.service';
import { ChatHistoryService } from './chat-history.service';

@Module({
  imports: [McpModule],
  controllers: [AgentController],
  providers: [AgentService, VectorStoreService, ChatHistoryService],
  exports: [AgentService],
})
export class AgentModule {}
