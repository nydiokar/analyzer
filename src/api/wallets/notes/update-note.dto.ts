import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateNoteDto {
  @ApiProperty({
    description: 'The updated content of the note.',
    example: 'This is the updated note content.',
    required: false,
    maxLength: 2000, 
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000) // Optional: set a max length for note content
  content?: string;
} 