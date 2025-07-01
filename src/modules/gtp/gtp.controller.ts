import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { GtpService } from './gtp.service';
import { CreateGtpDto } from './dto/create-gtp.dto';
import { UpdateGtpDto } from './dto/update-gtp.dto';
import { GtpLocation } from 'src/entities';

@Controller('gtp')
export class GtpController {
  constructor(private readonly gtpService: GtpService) {}

  @Post()
  async create(@Body() createGtpDto: GtpLocation) {
    return await this.gtpService.create(createGtpDto);
  }

  @Get()
  findAll() {
    return this.gtpService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.gtpService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateGtpDto: GtpLocation) {
    return await this.gtpService.update(id, updateGtpDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await  this.gtpService.remove(id);
  }
}
