import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class PipelineRunDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Name of the pipeline configured inside config.json',
    example: 'Customer Support Pipeline',
  })
  pipelineName: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'User input that will be fed into the workflow',
    example: 'The customer cannot access their workspace and needs urgent help.',
  })
  input: string;
}

export class PipelineStepDto {
  @ApiProperty()
  nodeId: string;

  @ApiProperty()
  type: string;

  @ApiProperty({
    description: 'Raw output returned by the node execution',
  })
  output: any;

  @ApiProperty({
    required: false,
    description: 'Extra diagnostic information collected while running the node',
  })
  metadata?: Record<string, any>;
}

export class PipelineRunResponseDto {
  @ApiProperty()
  pipelineName: string;

  @ApiProperty()
  finalOutput: string;

  @ApiProperty({ required: false })
  intent?: string;

  @ApiProperty({ required: false })
  context?: string;

  @ApiProperty({ type: () => [PipelineStepDto] })
  steps: PipelineStepDto[];

  @ApiProperty()
  timestamp: string;
}
