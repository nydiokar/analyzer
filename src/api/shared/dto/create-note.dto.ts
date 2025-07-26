import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateNoteDto {
  @ApiProperty({
    description: 'The content of the note.',
    example: 'This wallet looks suspicious, needs further investigation.',
  })
  @IsString()
  @IsNotEmpty()
  content: string;
} 