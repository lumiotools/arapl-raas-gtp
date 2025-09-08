import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { BaseopsTaskService } from './baseops_task.service';
import { CreateBaseopsTaskDto } from './dto/create-baseops_task.dto';
import { UpdateBaseopsTaskDto } from './dto/update-baseops_task.dto';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('baseops-task')
export class BaseopsTaskController {
  constructor(private readonly baseopsTaskService: BaseopsTaskService) {}

  @Post()
  create(@Body() createBaseopsTaskDto: CreateBaseopsTaskDto) {
    return this.baseopsTaskService.create(createBaseopsTaskDto);
  }
  
  @Post('upload-tasks')
  @UseInterceptors(FileInterceptor('file'))
  async uploadTasks(@UploadedFile() file: Express.Multer.File, @Query('priority') priority: string) {
    try {
      const priorityNum = priority ? +priority : 1; // Default to 1 if not provided
      const csvData = file.buffer.toString('utf-8');
      const result = await this.baseopsTaskService.processCsvTasks(csvData, priorityNum);
      return {
        success: true,
        message: 'All tasks processed successfully',
        data: result
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Failed to process CSV tasks'
      };
    }
  }

  @Get()
  findAll() {
    return this.baseopsTaskService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.baseopsTaskService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateBaseopsTaskDto: UpdateBaseopsTaskDto) {
    return this.baseopsTaskService.update(+id, updateBaseopsTaskDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.baseopsTaskService.remove(+id);
  }
}
