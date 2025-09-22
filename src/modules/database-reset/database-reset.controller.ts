import { Controller, Post, HttpStatus, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DatabaseResetService } from './database-reset.service';
import { ResetResponseDto } from './dto/reset-response.dto';
import { Roles } from '../auth/guard/roles.decorator';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Role } from 'src/entities/user.entity';

@ApiTags('Database Reset')
@Controller('database-reset')
export class DatabaseResetController {
  constructor(private readonly databaseResetService: DatabaseResetService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  @ApiOperation({
    summary: 'Reset database to clean state',
    description: `
      Resets the database to a clean state by:
      1. Deleting all order items
      2. Deleting all orders  
      3. Deleting all station requests
      4. Deleting all product requirements
      5. Deleting all tasks
      6. Deleting all batches
      7. Deleting all inventory
      8. Resetting all stations to AVAILABLE status
      9. Resetting all waiting locations to AVAILABLE status
      
      ⚠️ WARNING: This operation cannot be undone!
    `,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Database reset completed successfully',
    type: ResetResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Database reset failed',
  })
  async resetDatabase(): Promise<ResetResponseDto> {
    return this.databaseResetService.resetDatabase();
  }

  @Post('with-sequences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset database and sequence counters',
    description: `
      Resets the database to a clean state and also resets all ID sequence counters to start from 1.
      This is useful for development environments where you want completely fresh IDs.
      
      ⚠️ WARNING: This operation cannot be undone!
    `,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Database and sequences reset completed successfully',
    type: ResetResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Database reset failed',
  })
  async resetDatabaseWithSequences(): Promise<ResetResponseDto> {
    return this.databaseResetService.resetDatabaseAndSequences();
  }
}
