import { BadRequestException, Injectable } from '@nestjs/common';
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
import { OperationType, Robot } from 'src/entities/robot.entity';

@Injectable()
export class BaseopsTaskService {
  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly BaseOpsLocationManagerService: BaseOpsLocationManagerService,
    private readonly httpService: HttpService,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Batch)
    private readonly batchRepository: Repository<Batch>,
    @InjectRepository(Robot)
    private readonly robotRepository: Repository<Robot>,
  ) {}

  create(createBaseopsTaskDto: CreateBaseopsTaskDto) {
    return 'This action adds a new baseopsTask';
  }

  findAll() {
    // Return tasks that originate from baseops flows.
    // The CSV importer in this module creates tasks with TaskType.CROSSDOCK
    // and MOVE_TYPE.ZONE_TO_ZONE — treat those as "base ops" tasks.
    return this.taskRepository.find({
      where: [
        { task_type: TaskType.BASEOPS },
        { move_type: MOVE_TYPE.ZONE_TO_ZONE },
      ],
      relations: ['batch'],
      order: { created_at: 'DESC' },
    });
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
  async cronProcessNextTask(): Promise<void> {
    try {
      await this.processNextTask();
    } catch (error) {
      console.error('Error in cron job processNextTask:', error);
    }
  }
  async findNextTask(): Promise<Task | null> {
    const nextTask = await this.taskRepository.findOne({
      where: {
        task_type: TaskType.BASEOPS,
        status: TaskStatus.PENDING,
        move_type: MOVE_TYPE.ZONE_TO_ZONE,
      },
      relations: ['batch'],
      order: {
        batch: { priority: 'ASC', created_at: 'ASC' },
        priority: 'ASC',
        created_at: 'ASC'
      },
    });
    return nextTask;
  }
  async processNextTask(): Promise<string | null> {
    // ---> check if there are robots available in the system to dispatch the task.
    const robotAvailable = await this.isRobotAvailable();
    if (!robotAvailable){
      console.log('No robots available to process BaseOps tasks at the moment.');
      return null;
    }
    const isWaiting = await this.checkIfSystemIsInWaitingState();
    if (isWaiting){
      console.log('System is in waiting state, not dispatching new BaseOps tasks.');
      return null;
    }

    // ---> find next to process, task_type=BaseOps, status=PENDING, move_type=ZONE_TO_ZONE, its batch should have lowest priority 
    const nextTask = await this.findNextTask();

    if (!nextTask) {
      console.log('No pending BaseOps tasks found.');
      return null;
    }

    try {
      // Your batch processing logic here
      await this.processTask(nextTask);
      return nextTask.task_id;

    } catch (error) {
      console.error(`Error sending batch ${nextTask.batch.batch_id} to WMS Layer:`, error);
      throw error;
    }
  }

  private async processTask(task: Task): Promise<void> {
    // Implement your actual task processing logic here
    console.log(`Processing task: ${task.task_id}`);
    if (!task) return;
    const req_tasks : any[] = [];
    let end_location_id: string | null = null;
    if (task.end_location.location_attribute?.attribute_name === "ZONE"){
      // write the logic to find the pallet location in that zone
      end_location_id = await this.BaseOpsLocationManagerService.findOptimalDropLocation(task.end_location.location_attribute?.attribute_value);
      if (!end_location_id){
        console.log(`No available drop location in zone ${task.end_location.location_attribute?.attribute_value}, re-queue the task ${task.task_id}`);
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
      console.log(`Location ${end_location_id} is not available.`);
      return;
    }
    const reserveStartLocation = await this.BaseOpsLocationManagerService.reserveLocation(task.start_location.location_id);
    if (!reserveStartLocation){
      console.log(`Location ${task.start_location.location_id} is not available.`);
      await this.BaseOpsLocationManagerService.freeLocation(end_location_id);
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
    const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
    const warehouse_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
    const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';
    const req_body = {
      batch_type: "DISCRETE",
      batch_priority: task.batch.priority,
      tasks: req_tasks
    }; 
    try {
      await firstValueFrom(
        this.httpService.post(`${wms_base_url}/robot-job/${warehouse_name}/tasks`, req_body, {
          headers: {
            'authorization': `${warehouse_key}`,
            'Content-Type': 'application/json'
          }
        })
      );
    } catch (error) {
      console.error(`Error sending batch ${task.batch.batch_id} to WMS Layer:`, error);
      return;
    }
    await this.incrementRobotInUse();
    await this.taskRepository.update(
      {task_id: task.task_id},
      {status: TaskStatus.ASSIGNED}
    );
  }

    async processCsvTasks(csvData: string, priority: number): Promise<any> {
      // Parse the CSV data
      const lines = csvData.split('\n').filter(line => line.trim() !== '');
      const headers = lines[0].split(',').map(header => header.trim());

      // Process each line of the CSV
      const tasks = lines.slice(1).map((line, index) => {
        const values = line.split(',').map(value => value.trim());
        const task: any = {};
        headers.forEach((header, headerIndex) => {
          task[header] = values[headerIndex] || '';
        });
        task._rowNumber = index + 2; // For error reporting (accounting for header row)
        return task;
      });

      // ===== VALIDATION SECTION =====
      const validationErrors: string[] = [];
      const startLocationIds = new Set<string>();
      const palletEndLocationIds = new Set<string>();

      for (const task of tasks) {
        const rowNum = task._rowNumber;
        
        // 1. Validate start_location_type is always PALLET
        if (task['start_location_location_type'] !== 'PALLET') {
          validationErrors.push(`Row ${rowNum-1}: start_location_type must be 'PALLET', found '${task['start_location_location_type']}'`);
        }

        // 2. Check for duplicate start_location_ids
        const startLocationId = task['start_location_location_id'];
        if (!startLocationId) {
          validationErrors.push(`Row ${rowNum-1}: start_location_location_id is required`);
        } else if (startLocationIds.has(startLocationId)) {
          validationErrors.push(`Row ${rowNum-1}: Duplicate start_location_id '${startLocationId}' found`);
        } else {
          startLocationIds.add(startLocationId);
        }

        // 3. Validate end_location_type is either PALLET or ZONE
        const endLocationType = task['end_location_location_type'];
        if (endLocationType !== 'PALLET' && endLocationType !== 'ZONE') {
          validationErrors.push(`Row ${rowNum-1}: end_location_type must be 'PALLET' or 'ZONE', found '${endLocationType}'`);
        }

        // 4. Check for duplicate pallet end_location_ids
        const endLocationId = task['end_location_location_id'];
        if (!endLocationId) {
          validationErrors.push(`Row ${rowNum-1}: end_location_location_id is required`);
        } else if (endLocationType === 'PALLET') {
          if (palletEndLocationIds.has(endLocationId)) {
            validationErrors.push(`Row ${rowNum-1}: Duplicate pallet end_location_id '${endLocationId}' found`);
          } else {
            palletEndLocationIds.add(endLocationId);
          }
        }

        // 5. Additional validation - check required fields
        // if (!task['barcode_number']) {
        //   validationErrors.push(`Row ${rowNum-1}: barcode_number is required`);
        // }
        
        // 6. check the priority column for HIGH, MEDIUM and LOW
        const priorityValue = task['priority'];
        if (priorityValue !== 'HIGH' && priorityValue !== 'MEDIUM' && priorityValue !== 'LOW') {
          validationErrors.push(`Row ${rowNum-1}: priority must be 'HIGH', 'MEDIUM', or 'LOW', found '${priorityValue}'`);
        }

        // 7. Check if the start and end location ids exist in the system and they are available
        const startLocationValid = await this.BaseOpsLocationManagerService.isValidLocationId(startLocationId, true);
        if (!startLocationValid) {
          validationErrors.push(`Row ${rowNum-1}: start_location_location_id '${startLocationId}' is not available or does not exist in the system`);
        }
        const OtherTaskWithStartLocation = await this.BaseOpsLocationManagerService.otherTaskWithStartLocation(startLocationId);
        if (OtherTaskWithStartLocation){
          validationErrors.push(`Row ${rowNum-1}: start_location_location_id '${startLocationId}' is already assigned to another pending task (${OtherTaskWithStartLocation})`);
        }
        if (endLocationType == 'PALLET') {
          const endLocationValid = await this.BaseOpsLocationManagerService.isValidLocationId(endLocationId, false);
          console.log(`endlocation validation for ${endLocationId}: ${endLocationValid}`);
          if (!endLocationValid) {
            validationErrors.push(`Row ${rowNum-1}: end_location_location_id '${endLocationId}' is not available or does not exist in the system`);
          }
          const otherTaskWithEndLocation = await this.BaseOpsLocationManagerService.otherTaskWithEndLocation(endLocationId);
          if (otherTaskWithEndLocation){
            validationErrors.push(`Row ${rowNum-1}: end_location_location_id '${endLocationId}' is already assigned to another pending task (${otherTaskWithEndLocation})`);
          }
        }

      }
      console.log(`Validation completed with ${validationErrors.length} errors.`);
      // If there are validation errors, throw them
      if (validationErrors.length > 0) {
        throw new BadRequestException(`CSV Validation Failed:\n${validationErrors.join('\n')}`);
      }

      // Remove the temporary row number field before processing
      tasks.forEach(task => delete task._rowNumber);

      // ===== END VALIDATION SECTION =====

      // Generate a batch
      const batch_id = await this.orchestratorService.generateBatchId();
      await this.orchestratorService.createBatch(batch_id, null, null);
      const batch = await this.batchRepository.findOne({ where: { batch_id: batch_id } });
      if (!batch) {
        throw new Error('Failed to create or retrieve the batch');
      }
      batch.priority = priority;
      await this.batchRepository.save(batch);
      
      for (const task of tasks) {
        const newTask = new Task();
        newTask.batch_id = batch.batch_id;
        newTask.task_type = TaskType.BASEOPS;
        newTask.status = TaskStatus.PENDING;
        newTask.move_type = MOVE_TYPE.ZONE_TO_ZONE;
        newTask.sequence_order = 1;
        newTask.task_dependency = null as any;
        newTask.robot_id = null as any;
        newTask.priority = task['priority'] === 'HIGH' ? 1 : (task['priority'] === 'MEDIUM' ? 2 : 3);
        
        let end_location_id = null;
        if (task['end_location_location_type'] === 'PALLET') {
          end_location_id = task['end_location_location_id'];
        }
        
        newTask.start_location = {
          location_id: task['start_location_location_id'],
          location_type: LocationType.PALLET, // Fixed since we validate it's always PALLET
          location_action: LocationAction.PICK,
          location_dimension: {
            length: 1, width: 1, height: 1
          },
          location_attribute: {
            attribute_name: 'Pallet', 
            attribute_value: task['start_location_location_id']
          },
        };
        
        newTask.end_location = {
          location_id: end_location_id !== null ? end_location_id : 'To be decided',
          location_type: task['end_location_location_type'] === 'PALLET' ? LocationType.PALLET : LocationType.ZONE,
          location_action: LocationAction.DROP,
          location_dimension: {
            length: 1, width: 1, height: 1
          },
          location_attribute: {
            attribute_name: end_location_id === null ? 'ZONE' : 'Pallet',
            attribute_value: task['end_location_location_id']
          }
        };
        
        newTask.wait = null as any;
        newTask.cargos = [{
          cargo_code: task['barcode_number'] || '',
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

  async isRobotAvailable(): Promise<boolean> {
    const robots = await this.robotRepository.find({where:{operation_type: OperationType.BASEOPS}});
    if (robots.length === 0){
      return false;
    }
    const robot = robots[0];
    return robot.total_robots - robot.robot_in_use > 0
  }
  async incrementRobotInUse(): Promise<void> {
    console.log('increment robot in use count');
    const queryRunner = this.robotRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
        // Atomic increment - no race condition possible
        const result = await queryRunner.manager
            .createQueryBuilder()
            .update(Robot)
            .set({ 
                robot_in_use: () => "robot_in_use + 1" 
            })
            .where("operation_type = :opType", { opType: OperationType.BASEOPS })
            .execute();

        if (result.affected === 0) {
            throw new Error('No Robot Entry Found');
        }
        
        await queryRunner.commitTransaction();
    } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
    } finally {
        await queryRunner.release();
    }
  }

  async decrementRobotInUse(): Promise<void> {
    const queryRunner = this.robotRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
        // Atomic decrement with safety check to prevent negative values
        const result = await queryRunner.manager
            .createQueryBuilder()
            .update(Robot)
            .set({ 
                robot_in_use: () => "GREATEST(robot_in_use - 1, 0)" 
            })
            .where("operation_type = :opType", { opType: OperationType.BASEOPS })
            .execute();

        if (result.affected === 0) {
            throw new Error('No Robot Entry Found');
        }
        await queryRunner.commitTransaction();
    } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
    } finally {
        await queryRunner.release();
    }
  }

  async checkIfSystemIsInWaitingState(): Promise<boolean> {
    const robots = await this.robotRepository.find({where: {operation_type: OperationType.BASEOPS}});
    if (robots.length === 0){
      return false;
    }
    const isWaiting = robots[0].is_waiting;
    return isWaiting;
  }

  async markSystemAsWaiting(): Promise<void> {
    const queryRunner = this.robotRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    try {
      const robots = await queryRunner.manager.find(Robot);
      if (robots.length === 0) {
      throw new Error('No Robot Entry Found');
      }
      await queryRunner.manager.update(
        Robot,
        { id: robots[0].id, operation_type: OperationType.BASEOPS },
        { is_waiting: true }
      );
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async unmarkSystemAsWaiting(): Promise<void> {
    const queryRunner = this.robotRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const robots = await queryRunner.manager.find(Robot);
      if (robots.length === 0) {
        throw new Error('No Robot Entry Found');
      }
      await queryRunner.manager.update(Robot, { id: robots[0].id, operation_type: OperationType.BASEOPS }, { is_waiting: false });
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async setInitialConfiguration(): Promise<void> {
    const robots = await this.robotRepository.find({where: {operation_type: OperationType.BASEOPS}});
    console.log(`Current BaseOps robot configurations: ${robots.length}`);
    if (robots.length === 0){
      const newRobotConfig = new Robot();
      newRobotConfig.operation_type = OperationType.BASEOPS;
      newRobotConfig.total_robots = 1;
      newRobotConfig.robot_in_use = 0;
      newRobotConfig.is_waiting = false;
      await this.robotRepository.save(newRobotConfig);
    }
  }
}
