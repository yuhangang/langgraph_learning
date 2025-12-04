import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsUUID,
  IsObject,
} from 'class-validator';

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

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'Existing conversation ID to append the message to',
    required: false,
  })
  conversationId?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Customer identifier for chat attribution',
    required: false,
  })
  customerId?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Conversation subject or short summary',
    required: false,
  })
  subject?: string;

  @IsOptional()
  @IsObject()
  @ApiProperty({
    description: 'Additional metadata to persist with the conversation',
    required: false,
  })
  metadata?: Record<string, any>;
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
