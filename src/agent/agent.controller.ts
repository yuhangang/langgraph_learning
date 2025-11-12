import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AgentService } from './agent.service';
import { AgentQueryDto, AgentResponseDto } from './dto/agent-query.dto';
import { PipelineRunDto, PipelineRunResponseDto } from './dto/pipeline-run.dto';

@ApiTags('agent')
@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('query')
  @ApiOperation({ summary: 'Send a query to the LangGraph agent' })
  @ApiResponse({ 
    status: 200, 
    description: 'Agent response',
    type: AgentResponseDto,
  })
  async query(@Body() queryDto: AgentQueryDto): Promise<AgentResponseDto> {
    return this.agentService.processQuery(queryDto);
  }

  @Post('stream')
  @ApiOperation({ summary: 'Stream agent response' })
  async streamQuery(@Body() queryDto: AgentQueryDto) {
    return this.agentService.processQueryStream(queryDto);
  }

  @Post('pipeline/run')
  @ApiOperation({ summary: 'Execute a configured workflow pipeline' })
  @ApiResponse({
    status: 200,
    description: 'Pipeline execution result',
    type: PipelineRunResponseDto,
  })
  async runPipeline(@Body() pipelineRunDto: PipelineRunDto): Promise<PipelineRunResponseDto> {
    return this.agentService.runPipeline(pipelineRunDto);
  }

  @Get('health')
  @ApiOperation({ summary: 'Check agent service health' })
  async health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
