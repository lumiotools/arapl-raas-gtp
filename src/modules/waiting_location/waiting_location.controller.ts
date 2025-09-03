import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, HttpStatus } from '@nestjs/common';
import { WaitingLocationService } from './waiting_location.service';
import { CreateWaitingLocationDto } from './dto/create-waiting_location.dto';
import { UpdateWaitingLocationDto } from './dto/update-waiting_location.dto';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';
import { ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { NotFoundResponseDto } from 'src/common/dto/common-responses.dto';

@Controller('waiting-location')
export class WaitingLocationController {
  constructor(private readonly waitingLocationService: WaitingLocationService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async create(@Body() createWaitingLocationDto: CreateWaitingLocationDto) {
    return await this.waitingLocationService.create(createWaitingLocationDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get()
  async findAll() {
    return await this.waitingLocationService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async findOne(@Param('id') id: string) {
    return await this.waitingLocationService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async update(@Param('id') id: string, @Body() updateWaitingLocationDto: UpdateWaitingLocationDto) {
    return await this.waitingLocationService.update(id, updateWaitingLocationDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.waitingLocationService.remove(id);
  }

  @Get(':id/active-robot')
  @ApiOperation({
    summary: 'Get the active robot at a station',
    description: 'Retrieve the currently active robot assigned to the specified station.'
  })
  @ApiParam({ name: 'id', description: 'Station ID', example: 'ST001' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Active robot at the station',
    schema: {
      example: {
        robot_id: 'RB001',
        status: 'active',
        assigned_station: 'ST001',
        // ...other robot fields
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Station or active robot not found',
    type: NotFoundResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  async getActiveRobot(@Param('id') id: string) {
    return await this.waitingLocationService.getActiveRobotAtWaiting(id);
  }
}
