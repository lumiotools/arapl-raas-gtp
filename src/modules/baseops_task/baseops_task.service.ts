import { Injectable } from '@nestjs/common';
import { CreateBaseopsTaskDto } from './dto/create-baseops_task.dto';
import { UpdateBaseopsTaskDto } from './dto/update-baseops_task.dto';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task, TaskStatus, TaskType, MOVE_TYPE } from 'src/entities/task.entity';
import { LocationAction, LocationType } from 'src/entities/location.entity';
import { Batch } from 'src/entities/batch.entity';

@Injectable()
export class BaseopsTaskService {
  constructor(
    private readonly orchestratorService: OrchestratorService,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Batch)
    private readonly batchRepository: Repository<Batch>,
  ) {}

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
    // generate a batch
    const batch_id = await this.orchestratorService.generateBatchId();
    await this.orchestratorService.createBatch(batch_id, null, null);
    const batch = await this.batchRepository.findOne({ where: { batch_id: batch_id } });
    if (!batch) {
      throw new Error('Failed to create or retrieve the batch');
    }
    batch.priority = priority;
    await this.batchRepository.save(batch);
    
    for (const task of tasks){
      const newTask = new Task();
      newTask.batch_id = batch.batch_id;
      newTask.task_type = TaskType.CROSSDOCK;
      newTask.status = TaskStatus.PENDING;
      newTask.move_type = MOVE_TYPE.ZONE_TO_ZONE;
      newTask.sequence_order = 0;
      newTask.task_dependency = null as any;
      newTask.robot_id = null as any;
      newTask.start_location = {
        location_id: task['start_location_location_id'],
        location_type: LocationType.ZONE,
        location_action: LocationAction.PICK,
        location_dimension: {
          length: 1, width: 1, height: 1
        },
        location_attribute: {
          attribute_name: 'zone_id',
          attribute_value: task['start_location_zone_id'] || ''
        }
      };
      newTask.end_location = {
        location_id: task['end_location_location_id'],
        location_type: LocationType.ZONE,
        location_action: LocationAction.DROP,
        location_dimension: {
          length: 1, width: 1, height: 1
        },
        location_attribute: {
          attribute_name: 'zone_id',
          attribute_value: task['end_location_zone_id'] || ''
        }
      };
      newTask.wait = null as any;
      newTask.cargos = [{
        cargo_code: task['pallet_id'],
        cargo_type: 'Pallet',
        cargo_dimension: {
          length: 1, width: 1, height: 1
        },
        cargo_attributes: null,
        cargo_weight: 1,
      }];
      await this.taskRepository.save(newTask);
    }

    return tasks;
  }
}
