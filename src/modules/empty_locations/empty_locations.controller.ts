import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { EmptyLocationsService } from './empty_locations.service';
import { CreateEmptyLocationDto } from './dto/create-empty_location.dto';
import { UpdateEmptyLocationDto } from './dto/update-empty_location.dto';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';
import { Role } from 'src/entities/user.entity';

@Controller('empty-locations')
export class EmptyLocationsController {
  constructor(private readonly emptyLocationsService: EmptyLocationsService) {}

  @Post()
  create(@Body() createEmptyLocationDto: {location_id: string, location_name: string, is_active: boolean, priority: number}) {
    return this.emptyLocationsService.create(createEmptyLocationDto);
  }

  @Get()
  async findAll() {
    return await this.emptyLocationsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.emptyLocationsService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateEmptyLocationDto: {
    id: string,
    location_name: string,
    status: string,
    priority: number
  }) {
    return await this.emptyLocationsService.update(id, updateEmptyLocationDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.emptyLocationsService.remove(id);
  }

  @Patch('/update-allocation/:allocation_type')
  async updateAllocation(
    @Param('allocation_type') allocationType: 'ROUND_ROBIN' | 'MANUAL'
  ) {
    return await this.emptyLocationsService.updateAllocation(
      allocationType
    );
  }

  
  @Get(':id/active-robot')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async getActiveRobot(@Param('id') id: string) {
    return await this.emptyLocationsService.getActiveRobotAtEmptyLocation(id);
  }
}
