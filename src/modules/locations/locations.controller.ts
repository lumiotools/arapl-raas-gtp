import { Controller, Get, Body, Patch, Param } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  async findAll() {
    return await this.locationsService.findAll();
  }

  @Get('zones')
  async findZones() {
    return await this.locationsService.findZones();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateLocationDto: UpdateLocationDto) {
    return this.locationsService.update(id, updateLocationDto);
  }

  // Update a Zone's display name and/or Category attribute
  @Patch('zones/:zone_id')
  updateZone(@Param('zone_id') zoneId: string, @Body() updateZoneDto: UpdateZoneDto) {
    return this.locationsService.updateZone(zoneId, updateZoneDto);
  }

  @Get('zone/:zone_id')
  async findByZone(@Param('zone_id') zoneId: string) {
    return await this.locationsService.findByZone(zoneId);
  }
}
