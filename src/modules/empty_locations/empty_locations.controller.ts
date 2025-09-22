import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { EmptyLocationsService } from './empty_locations.service';
import { CreateEmptyLocationDto } from './dto/create-empty_location.dto';
import { UpdateEmptyLocationDto } from './dto/update-empty_location.dto';

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
  update(@Param('id') id: string, @Body() updateEmptyLocationDto: UpdateEmptyLocationDto) {
    return this.emptyLocationsService.update(+id, updateEmptyLocationDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.emptyLocationsService.remove(+id);
  }
}
