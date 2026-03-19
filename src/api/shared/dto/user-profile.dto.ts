import { ApiProperty } from '@nestjs/swagger';

export class UserProfileDto {
  @ApiProperty({ description: "Indicates if the user is a demo account", example: true })
  isDemo: boolean;

  @ApiProperty({ description: "The user's unique ID", example: "clxyz12345" })
  id: string;

  @ApiProperty({ description: "The user's display name", example: "SharpFalcon42", required: false, nullable: true })
  displayName?: string | null;
} 
