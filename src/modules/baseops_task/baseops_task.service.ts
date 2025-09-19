import { Injectable } from '@nestjs/common';
import { CreateBaseopsTaskDto } from './dto/create-baseops_task.dto';
import { UpdateBaseopsTaskDto } from './dto/update-baseops_task.dto';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task, TaskStatus, TaskType, MOVE_TYPE } from 'src/entities/task.entity';
import { LocationAction, LocationType } from 'src/entities/location.entity';
import { Batch, BatchStatus } from 'src/entities/batch.entity';
import { HeapPriorityQueueService } from './heap.service';
import { Cron } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { BaseOpsLocationManagerService } from './location_manager.service';

@Injectable()
export class BaseopsTaskService {
  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly queueService: HeapPriorityQueueService,
    private readonly BaseOpsLocationManagerService: BaseOpsLocationManagerService,
    private readonly httpService: HttpService,
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

  @Cron('*/5 * * * * *')
  async cronProcessNextBatch(): Promise<void> {
    try {
      await this.processNextBatch();
    } catch (error) {
      console.error('Error in cron job processNextBatch:', error);
    }
  }
  async processNextBatch(): Promise<string | null> {
    const batchId = this.queueService.dequeue();
    if (!batchId) {
      // console.log('No batches in the queue');
      return null;
    }

    try {
      // Your batch processing logic here
      await this.processBatch(batchId);
      return batchId;

    } catch (error) {
      console.error(`Error sending batch ${batchId} to WMS Layer:`, error);
      throw error;
    }
  }

  private async processBatch(batchId: string): Promise<void> {
    // Implement your actual batch processing logic here
    console.log(`Processing batch: ${batchId}`);
    const batch = await this.batchRepository.findOne({ where: { batch_id: batchId } });
    if (!batch) {throw new Error(`Batch with id ${batchId} not found`);}
    const tasks = await this.taskRepository.find({ where: { batch_id: batchId, move_type: MOVE_TYPE.ZONE_TO_ZONE, status: TaskStatus.PENDING } });
    if (tasks.length === 0) return;
    const req_tasks : any[] = [];
    for (const task of tasks) {
      // need to put the location valiation system here.
      // need to check if the destination location is occupied or not.
      // if the destination location is occupied, break the current task in to two, one to move to a transient location (waiting location),
      // another take the pallet from that transient location to the destination location.
      let end_location_id: string | null = null;
      if (task.end_location.location_attribute?.attribute_name === "Zone"){
        // write the logic to find the pallet location in that zone
        end_location_id = await this.BaseOpsLocationManagerService.findOptimalDropLocation(task.end_location.location_attribute?.attribute_value);
        if (!end_location_id){
          console.log(`No available drop location in zone ${task.end_location.location_attribute?.attribute_value}, re-queue the batch ${batchId}`);
          await this.queueService.addPendingBatch(batchId);
          return;
        }
        task.end_location.location_id = end_location_id;
        await this.taskRepository.update(
          {task_id: task.task_id},
          {end_location: task.end_location}
        );
      }
      else{
        end_location_id = task.end_location.location_id;
      }
      const reserveEndLocation = await this.BaseOpsLocationManagerService.reserveLocation(end_location_id);
      if (!reserveEndLocation){
        console.log(`Location ${end_location_id} is not available, re-queue the batch ${batchId}`);
        await this.queueService.addPendingBatch(batchId);
        return;
      }
      const reserveStartLocation = await this.BaseOpsLocationManagerService.reserveLocation(task.start_location.location_id);
      if (!reserveStartLocation){
        console.log(`Location ${task.start_location.location_id} is not available, re-queue the batch ${batchId}`);
        await this.BaseOpsLocationManagerService.freeLocation(end_location_id);
        await this.queueService.addPendingBatch(batchId);
        return;
      }
      req_tasks.push({
        task_id: task.task_id,
        task_type: task.task_type,
        task_dependency: task.task_dependency,
        robot_id: task.robot_id,
        start_location: {
          location_id: task.start_location.location_id,
          location_type: task.start_location.location_type,
          location_action: task.start_location.location_action,
          location_dimension: task.start_location.location_dimension,
        },
        end_location: {
          location_id: end_location_id,
          location_type: task.end_location.location_type,
          location_action: task.end_location.location_action,
          location_dimension: task.end_location.location_dimension,
        },
        wait: task.wait,
        cargos: task.cargos
      });
    }
    if (req_tasks.length === 0) return;
    const req_body = {
      batch_job_id: batchId,
      batch_type: "DISCRETE",
      tasks: req_tasks
    };
    const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
    const warehosue_key = process.env.WMS_WAREHOUSE_AUTH_kEY || 'test';
    const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';  

    try{
      await firstValueFrom(
        this.httpService.post(`${wms_base_url}/robot-job/${warehouse_name}/tasks`, req_body, {
          headers: {
            'authorization': `${warehosue_key}`,
            'Content-Type': 'application/json'
          }
        })
      );
    } catch (error) {
      console.error(`Error sending batch ${batchId} to WMS Layer:`, error);
      await this.queueService.addPendingBatch(batchId);
      return;
    }
    
    for (const task of req_tasks){
      await this.taskRepository.update(
        {task_id: task.task_id},
        {status: TaskStatus.ASSIGNED}
      );
    }
    if (req_tasks.length === tasks.length){
      await this.batchRepository.update(
        {batch_id: batchId},
        {status: BatchStatus.DISPATCHED}
      );
    }else{
      await this.queueService.addPendingBatch(batchId);
    }
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
      newTask.sequence_order = 1;
      newTask.task_dependency = null as any;
      newTask.robot_id = null as any;
      let end_location_id = null;
      if (task['end_location_location_type'] === LocationType.PALLET) {
        end_location_id = task['end_location_location_id'];
      }
      newTask.start_location = {
        location_id: task['start_location_location_id'],
        location_type: LocationType.ZONE,
        location_action: LocationAction.PICK,
        location_dimension: {
          length: 1, width: 1, height: 1
        },
        location_attribute: {attribute_name: 'Pallet', attribute_value: task['start_location_location_id']},
      };
      newTask.end_location = {
        location_id: end_location_id!==null ? end_location_id : 'unknown',
        location_type: LocationType.ZONE,
        location_action: LocationAction.DROP,
        location_dimension: {
          length: 1, width: 1, height: 1
        },
        location_attribute: {
          attribute_name: end_location_id==null ? 'Zone' : 'Pallet',
          attribute_value: task['end_location_location_id']
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

    await this.queueService.addPendingBatch(batch.batch_id);

    return tasks;
  }
}
