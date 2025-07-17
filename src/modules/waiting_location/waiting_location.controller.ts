import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { WaitingLocationService } from './waiting_location.service';
import { CreateWaitingLocationDto } from './dto/create-waiting_location.dto';
import { UpdateWaitingLocationDto } from './dto/update-waiting_location.dto';

@Controller('waiting-location')
export class WaitingLocationController {
  constructor(private readonly waitingLocationService: WaitingLocationService) {}

  @Post()
  async create(@Body() createWaitingLocationDto: CreateWaitingLocationDto) {
    return await this.waitingLocationService.create(createWaitingLocationDto);
  }

  @Get()
  async findAll() {
    return await this.waitingLocationService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.waitingLocationService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateWaitingLocationDto: UpdateWaitingLocationDto) {
    return await this.waitingLocationService.update(id, updateWaitingLocationDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.waitingLocationService.remove(id);
  }
}
