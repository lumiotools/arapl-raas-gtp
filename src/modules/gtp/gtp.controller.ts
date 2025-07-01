import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { GtpService } from './gtp.service';
import { CreateGtpDto } from './dto/create-gtp.dto';
import { UpdateGtpDto } from './dto/update-gtp.dto';
import { GtpLocation } from 'src/entities';

@Controller('gtp')
export class GtpController {
  constructor(private readonly gtpService: GtpService) {}

  @Post()
  create(@Body() createGtpDto: GtpLocation) {
    return this.gtpService.create(createGtpDto);
  }

  @Get()
  findAll() {
    return this.gtpService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.gtpService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateGtpDto: GtpLocation) {
    return this.gtpService.update(id, updateGtpDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.gtpService.remove(id);
  }
}
