import { ApiProperty } from '@nestjs/swagger';

export class ResetResponseDto {
  @ApiProperty({
    description: 'Whether the reset operation was successful',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Success message',
    example: 'Database reset completed successfully',
  })
  message: string;
}
