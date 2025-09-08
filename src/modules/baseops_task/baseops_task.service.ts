import { Injectable } from '@nestjs/common';
import { CreateBaseopsTaskDto } from './dto/create-baseops_task.dto';
import { UpdateBaseopsTaskDto } from './dto/update-baseops_task.dto';

@Injectable()
export class BaseopsTaskService {
  create(createBaseopsTaskDto: CreateBaseopsTaskDto) {
    return 'This action adds a new baseopsTask';
  }

  findAll() {
    return `This action returns all baseopsTask`;
  }

  findOne(id: number) {
    return `This action returns a #${id} baseopsTask`;
  }

  update(id: number, updateBaseopsTaskDto: UpdateBaseopsTaskDto) {
    return `This action updates a #${id} baseopsTask`;
  }

  remove(id: number) {
    return `This action removes a #${id} baseopsTask`;
  }

  async processCsvTasks(csvData: string, priority: number): Promise<any> {
    // Parse the CSV data
    const lines = csvData.split('\n').filter(line => line.trim() !== '');
    const headers = lines[0].split(',').map(header => header.trim());

    // Process each line of the CSV
    const tasks = lines.slice(1).map(line => {
      const values = line.split(',').map(value => value.trim());
      const task: any = {};
      headers.forEach((header, index) => {
        task[header] = values[index] || '';
      });
      return task;
    });

    console.log(`tasks: ${JSON.stringify(tasks)}`);

    return tasks;
  }
}
