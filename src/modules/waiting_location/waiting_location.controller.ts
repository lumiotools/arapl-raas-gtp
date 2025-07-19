import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { WaitingLocationService } from './waiting_location.service';
import { CreateWaitingLocationDto } from './dto/create-waiting_location.dto';
import { UpdateWaitingLocationDto } from './dto/update-waiting_location.dto';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';

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
}
