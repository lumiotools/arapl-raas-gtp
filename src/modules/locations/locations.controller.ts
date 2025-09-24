import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Post()
  create(@Body() createLocationDto: CreateLocationDto) {
    return this.locationsService.create(createLocationDto);
  }

  @Get()
  findAll() {
    return this.locationsService.findAll();
  }

  @Get('zones')
  async findZones() {
    return await this.locationsService.findZones();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.locationsService.findOne(+id);
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

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.locationsService.remove(+id);
  }

  @Get('zone/:zone_id')
  async findByZone(@Param('zone_id') zoneId: string) {
    return await this.locationsService.findByZone(zoneId);
  }
}
