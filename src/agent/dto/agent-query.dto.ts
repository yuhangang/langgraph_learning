import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class AgentQueryDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'User query to send to the agent',
    example: 'Calculate 25 * 48 and explain the steps',
  })
  query: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ApiProperty({
    description: 'MCP servers to use (optional)',
    example: ['math', 'filesystem'],
    required: false,
  })
  mcpServers?: string[];

  @IsOptional()
  @IsArray()
  @ApiProperty({
    description: 'Conversation history (optional)',
    required: false,
  })
  conversationHistory?: Array<{ role: string; content: string }>;
}

export class AgentResponseDto {
  @ApiProperty()
  response: string;

  @ApiProperty()
  toolsUsed: string[];

  @ApiProperty()
  conversationId: string;

  @ApiProperty()
  timestamp: string;
}