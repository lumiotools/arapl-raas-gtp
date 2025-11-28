import { forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository, IsNull, LessThan, In } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { Batch, BatchStatus } from 'src/entities/batch.entity';
import { Task, TaskStatus, TaskType } from 'src/entities/task.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { Station, LocationStatus } from 'src/entities/station.entity';
import { WaitingLocation} from 'src/entities/waiting-location.entity';
import { WebhookRequestDto } from './dto/webhook-request.dto';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { LoggingService } from '../../services/logging.service';
import { WaitingLocationService } from '../waiting_location/waiting_location.service';
import { Robot, RobotStatus } from 'src/entities/robots.entity';
import { MOVE_TYPE } from 'src/entities/task.entity';
import { BaseopsTaskService } from '../baseops_task/baseops_task.service';
import { EmptyLocation } from 'src/entities/empty-location.entity';
import { LocationAction } from 'src/entities';
import { LocationType } from 'src/entities/location.entity';
import { CrossdockTaskService } from '../crossdock_task/crossdock_task.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(Batch)
    private readonly batchRepository: Repository<Batch>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    @InjectRepository(WaitingLocation)
    private readonly waitingLocationRepository: Repository<WaitingLocation>,
    @InjectRepository(EmptyLocation)
    private readonly emptyLocationRepository: Repository<EmptyLocation>,
    @InjectRepository(Robot)
    private readonly robotRepository: Repository<Robot>,
    @Inject(forwardRef(() => OrchestratorService))
    private readonly orchestratorService: OrchestratorService,
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => BaseopsTaskService))
    private readonly BaseOpsTaskService: BaseopsTaskService,
    @Inject(forwardRef(() => CrossdockTaskService))
    private readonly CrossdockTaskService: CrossdockTaskService,
  ) {}

  async processWebhook(webhookData: any): Promise<{ message: string }> {
    this.logger.log(`Processing webhook for batch ${webhookData.batch_job_id} with status ${webhookData.batch_job_status}`);
    this.logger.log(`Received ${webhookData.tasks.length} task status updates`);
    
    try {
      for (const taskStatus of webhookData.tasks) {
        await this.updateTaskStatus(webhookData.batch_job_id, taskStatus);
      }
      return { message: 'Webhook processed successfully' };
    } catch (error) {
      this.logger.error(`Error processing webhook: ${error.message}`);
      throw error;
    }
  }

  private async updateTaskStatus(fms_batch_id: string, taskStatusData: any): Promise<void> {
    // Find task by task_id only (ignore batch_id as instructed)
    const task = await this.taskRepository.findOne({
      where: { task_id: taskStatusData.task_id }
    });
    if (!task) {return;}
    if (task.status === TaskStatus.TRIGERRED) {
      this.logger.log(`Task ${taskStatusData.task_id} is already triggered - skipping update`);
      return;
    }
    // define priority for TaskStatus such that TRIGERRED = CANCELLED  > COMPLETED > PROCESSING > INQUEUE > ASSIGNED > PENDING
    const statusPriority = {
      [TaskStatus.TRIGERRED]: 7,
      [TaskStatus.CANCELLED]: 7,
      [TaskStatus.COMPLETED]: 6,
      [TaskStatus.PROCESSING]: 5,
      [TaskStatus.INQUEUE]: 4,
      [TaskStatus.ASSIGNED]: 3,
      [TaskStatus.PENDING]: 2
    };

    const oldStatus = task.status;
    const mappedStatus = this.mapTaskStatus(taskStatusData.status);

    if (statusPriority[mappedStatus] < statusPriority[oldStatus]) {
      this.logger.log(`Skipping status update for task ${taskStatusData.task_id}: new status ${mappedStatus} (priority ${statusPriority[mappedStatus]}) has lower priority than current status ${oldStatus} (priority ${statusPriority[oldStatus]})`);
      return;
    }

    task.robot_id = taskStatusData.robot_id || null;
    if (task.robot_id){
      await this.taskRepository.save(task);
    }
    

    if (oldStatus == mappedStatus) {
      this.logger.log(`No status change for task ${taskStatusData.task_id} - current status is already ${mappedStatus}`);
      return; // No change needed
    }
    
    // Log webhook received after duplicate check
    await this.loggingService.log(`Task ${taskStatusData.task_id}: Update Status from ${oldStatus} to ${mappedStatus} (robot: ${taskStatusData.robot_id || 'none'})`,
      task.task_type, taskStatusData.task_id, null
    );
  
    task.status = mappedStatus;
    task.robot_id = taskStatusData.robot_id || null;
    task.fms_batch_id = fms_batch_id;
    if (task.robot_id){
      await this.addRobotIfNotExists(task.robot_id, task.task_type);
      if (task.end_location.location_action === LocationAction.DROP && mappedStatus === TaskStatus.COMPLETED) {
        await this.updateRobotUsage(task.robot_id, false);
      }
      else {
        await this.updateRobotUsage(task.robot_id, true);
      }
    }
    
    const currentTime = new Date();
    if (mappedStatus === TaskStatus.INQUEUE) {
      task.inqueue = currentTime;
    } else if (mappedStatus === TaskStatus.PROCESSING) {
      task.processing = currentTime;
    } else if (mappedStatus === TaskStatus.COMPLETED) {
      task.completed = currentTime;
    } else if (mappedStatus === TaskStatus.TRIGERRED) {
      task.triggered = currentTime;
    }
    await this.taskRepository.save(task);

    if (task.task_type === TaskType.BASEOPS || task.task_type === TaskType.CROSSDOCK){
      const taskService = task.task_type === TaskType.BASEOPS ? this.BaseOpsTaskService.taskService : this.CrossdockTaskService.taskService;
      if (mappedStatus === TaskStatus.PROCESSING){
        await taskService.LocationManagerService.freeLocation(task.start_location.location_id);
        await this.loggingService.log(`Task ${task.task_id}: Freeing start location ${task.start_location.location_id}.`, task.task_type, task.task_id, task.batch_id);
      }
      if (mappedStatus === TaskStatus.COMPLETED){
        if(task.task_type !== TaskType.CROSSDOCK || task.move_type === MOVE_TYPE.DROP_ENTRY_TO_ZONE || task.move_type === MOVE_TYPE.ZONE_TO_ZONE) {
          await taskService.decrementRobotInUse();
          await taskService.LocationManagerService.occupyLocation(task.end_location.location_id);
          await this.loggingService.log(`Task ${task.task_id}: Completed. Occupied ${task.end_location.location_id} and decremented robot count.`, task.task_type, task.task_id, task.batch_id);
        }
        // Log current robot in use after decrement if service exposes the metric
        try {
          const current = await taskService.getRobotInUse();
          await this.loggingService.log(`Robot in use after completion: ${current}`, task.task_type, task.task_id, task.batch_id);
        } catch (err) {
          // ignore if metric not available
        }
      }
      // Crossdock internal cancellation handling for PICK/DROP ENTRY
      if (
        task.task_type === TaskType.CROSSDOCK &&
        mappedStatus === TaskStatus.COMPLETED &&
        (task.move_type === MOVE_TYPE.PICK_ENTRY || task.move_type === MOVE_TYPE.ZONE_TO_DROP_ENTRY)
      ) {
        await this.handleCrossdockCancellation(task);
        await this.updateBatchStatus(task.batch_id, task.task_type);
        return;
      }
      // Persist batch status to DB using BaseOps rules (mirrors findAllBatches logic)
      await this.updateBatchStatus(task.batch_id, task.task_type);
      await this.loggingService.log(`Task ${task.task_id}: Updated batch ${task.batch_id} status`, task.task_type, task.task_id, task.batch_id);
      return;
    }
    console.log(`------------------------running ------------------------------------------------------`)
    // Handle inventory updates based on task status changes
    await this.handleInventoryUpdates(task, oldStatus, mappedStatus, task.batch_id);
    
    await this.handleStationStatusUpdates(task,mappedStatus);

    // Handle waiting location updates
    await this.handleWaitingLocationStatusUpdates(task, mappedStatus);

    await this.handleCancelledUpdateds(task, mappedStatus);

    // Handle task completion based on destination type
    if (mappedStatus === TaskStatus.COMPLETED) {
      if (task && task.status === TaskStatus.COMPLETED) {
        const sourceType = task.start_location?.location_attribute.attribute_value;
        const destinationType = task.end_location?.location_attribute.attribute_value;
        if (sourceType === 'station' && task.start_location.location_id !== task.end_location.location_id){
          // free the source station
          await this.loggingService.log(`Task ${task.task_id}: Freeing source station ${task.start_location.location_id} (task completed).`, task.task_type, task.task_id, null);
          await this.stationRepository.update(
            { station_id: task.start_location.location_id, holded_by: task.task_dependency },
            { status: LocationStatus.AVAILABLE, holded_by: null }
          );
        } else if (sourceType === 'waiting_location' && task.start_location.location_id !== task.end_location.location_id){
          // free the source waiting location
          await this.loggingService.log(`Task ${task.task_id}: Freeing source waiting location ${task.start_location.location_id} (task completed).`, task.task_type, task.task_id, null);
          await this.waitingLocationRepository.update(
            { location_id: task.start_location.location_id, holded_by: task.task_dependency },
            { status: LocationStatus.AVAILABLE, holded_by: null }
          );
        }

        if (task.move_type===MOVE_TYPE.STATION_TO_EMPTY_LOCATION || task.move_type===MOVE_TYPE.WAITING_LOCATION_TO_EMPTY_LOCATION
          || task.move_type===MOVE_TYPE.EMPTY_TO_EMPTY_LOCATION
        ){
          await this.orchestratorService.decrementRobotInUse();
          await this.loggingService.log(`Task ${task.task_id}: Empty location ${task.end_location.location_id} marked as OCCUPIED.`, task.task_type, task.task_id, null);
          await this.loggingService.log(`Robot in use decremented. Current robot in use: ${await this.orchestratorService.getRobotInUse()}`, TaskType.GOODS_TO_PERSON, task.task_id, null);
          await this.emptyLocationRepository.update(
            { location_id: task.end_location.location_id },
            { status: LocationStatus.OCCUPIED }
          );
        }

        if (destinationType === 'inventory'){
          await this.orchestratorService.decrementRobotInUse();
          await this.loggingService.log(`Robot in use decremented. Current robot in use: ${await this.orchestratorService.getRobotInUse()}`, TaskType.GOODS_TO_PERSON, task.task_id, null);
        }
      }
    }
  }

  private mapTaskStatus(webhookStatus: string): TaskStatus {
    console.log(webhookStatus);
    const statusMap: { [key: string]: TaskStatus } = {
      'pending': TaskStatus.PENDING,
      'assigned': TaskStatus.ASSIGNED,
      'inqueue': TaskStatus.INQUEUE,
      'task_acknowledged': TaskStatus.INQUEUE,
      'robot_assigned': TaskStatus.INQUEUE,
      'in-queue': TaskStatus.INQUEUE,
      'processing': TaskStatus.PROCESSING,
      'in-progress': TaskStatus.PROCESSING,
      'in progress': TaskStatus.PROCESSING,
      'pickup_successful': TaskStatus.PROCESSING,
      'robot_movement_started': TaskStatus.PROCESSING,
      'completed': TaskStatus.COMPLETED,
      'cancelled': TaskStatus.CANCELLED,
      'canceled': TaskStatus.CANCELLED,
      'drop_successful': TaskStatus.COMPLETED,
      'task_completed': TaskStatus.COMPLETED,
      'task_cancelled': TaskStatus.CANCELLED,
      'task_canceled': TaskStatus.CANCELLED,
      'drop_rejected': TaskStatus.CANCELLED,
      'pick_rejected': TaskStatus.CANCELLED,
      'pick_failed': TaskStatus.CANCELLED,
      'drop_failed': TaskStatus.CANCELLED
    };

    const mapped = statusMap[webhookStatus.toLowerCase()];
    if (!mapped) {
      this.logger.warn(`Unknown task status: ${webhookStatus}, defaulting to PENDING`);
      return TaskStatus.PENDING;
    }
    console.log(`Mapping webhook status ${webhookStatus} to TaskStatus: ${mapped}`);
    return mapped;
  }

  private async releaseProcessingInventory(inventoryLocationId: any): Promise<void> {

    await this.inventoryRepository.update(
      { 
        id: inventoryLocationId,
      },
      {
        isProcessing: true,
        status: LocationStatus.AVAILABLE,
      }
    );
  }

  private async handleCancelledUpdateds(task: Task, mappedStatus: TaskStatus): Promise<void> {
    if (mappedStatus !== TaskStatus.CANCELLED){ return; }
    await this.loggingService.log(`Task ${task.task_id}: Task Cancelled`, task.task_type, task.task_id, null);
    if (task.move_type === MOVE_TYPE.STATION_TO_WAITING_LOCATION || task.move_type === MOVE_TYPE.INVENTORY_TO_WAITING_LOCATION){
      const destinationWaitingLocation = await this.waitingLocationRepository.findOne({ where: { location_id: task.end_location.location_id } });
      if (destinationWaitingLocation){
        destinationWaitingLocation.status = LocationStatus.AVAILABLE;
        destinationWaitingLocation.holded_by = null;
        await this.loggingService.log(`Task ${task.task_id}: Marking waiting location ${destinationWaitingLocation.location_id} as AVAILABLE (task cancelled).`, task.task_type, task.task_id, null);
        await this.waitingLocationRepository.save(destinationWaitingLocation);
      }
    }
    else if (task.move_type === MOVE_TYPE.WAITING_LOCATION_TO_INVENTORY || task.move_type === MOVE_TYPE.STATION_TO_INVENTORY || task.move_type === MOVE_TYPE.INVENTORY_TO_INVENTORY){
      const destinationInventoryLocation = await this.inventoryRepository.findOne({ where: { id: task.end_location.location_id } });
      if (destinationInventoryLocation){
        destinationInventoryLocation.status = LocationStatus.AVAILABLE;
        await this.inventoryRepository.save(destinationInventoryLocation);
      }
    }
    if (task.move_type === MOVE_TYPE.STATION_TO_EMPTY_LOCATION){
      const destinationEmptyLocation = await this.emptyLocationRepository.findOne({ where: { location_id: task.end_location.location_id } });
      if (destinationEmptyLocation){
        destinationEmptyLocation.status = LocationStatus.AVAILABLE;
        await this.emptyLocationRepository.save(destinationEmptyLocation);
      }
    }
    else if (task.move_type === MOVE_TYPE.INVENTORY_TO_STATION){
      const destinationStation = await this.stationRepository.findOne({ where: { station_id: task.end_location.location_id } });
      if (destinationStation){
        destinationStation.status = LocationStatus.AVAILABLE;
        destinationStation.holded_by = null;
        await this.loggingService.log(`Task ${task.task_id}: Marking station ${destinationStation.station_id} as AVAILABLE (task cancelled).`, task.task_type, task.task_id, null);
        await this.stationRepository.save(destinationStation);
      }
    }
    else if (task.move_type === MOVE_TYPE.WAITING_LOCATION_TO_STATION){
      const destinationStation = await this.stationRepository.findOne({ where: { station_id: task.end_location.location_id } });
      if (destinationStation){
        destinationStation.status = LocationStatus.AVAILABLE;
        destinationStation.holded_by = null;
        await this.loggingService.log(`Task ${task.task_id}: Marking station ${destinationStation.station_id} as AVAILABLE (task cancelled).`, task.task_type, task.task_id, null);
        await this.stationRepository.save(destinationStation);
      }
    }
    else if (task.move_type === MOVE_TYPE.STATION_TO_STATION){
      const destinationStation = await this.stationRepository.findOne({ where: { station_id: task.end_location.location_id } });
      if (destinationStation){
        destinationStation.status = LocationStatus.AVAILABLE;
        destinationStation.holded_by = null;
        await this.loggingService.log(`Task ${task.task_id}: Marking station ${destinationStation.station_id} as AVAILABLE (task cancelled).`, task.task_type, task.task_id, null);
        await this.stationRepository.save(destinationStation);
      }
    }
    else if (task.move_type===MOVE_TYPE.WAITING_LOCATION_TO_EMPTY_LOCATION){
      const destinationEmptyLocation = await this.emptyLocationRepository.findOne({ where: { location_id: task.end_location.location_id } });
      if (destinationEmptyLocation){
        destinationEmptyLocation.status = LocationStatus.AVAILABLE;
        await this.emptyLocationRepository.save(destinationEmptyLocation);
      }
    }
    else if (task.move_type===MOVE_TYPE.EMPTY_TO_EMPTY_LOCATION){
      const destinationEmptyLocation = await this.emptyLocationRepository.findOne({ where: { location_id: task.end_location.location_id } });
      if (destinationEmptyLocation){
        destinationEmptyLocation.status = LocationStatus.AVAILABLE;
        await this.emptyLocationRepository.save(destinationEmptyLocation);
      }
    }
  }

  private async handleInventoryUpdates(task: Task, oldStatus: TaskStatus, newStatus: TaskStatus, batchId: string): Promise<void> {
    try {
      // Case 1: FIRST task from inventory goes to PROCESSING - set inventory to 
      if ((newStatus === TaskStatus.PROCESSING || newStatus === TaskStatus.COMPLETED) && this.isTaskFromInventory(task)) {
        await this.releaseProcessingInventory(task.start_location.location_id);
        if (newStatus === TaskStatus.PROCESSING){
          await this.orchestratorService.unmarkSystemAsWaiting();
          await this.loggingService.log(`Task ${task.task_id}: System removed from waiting state.`, task.task_type, task.task_id, null);
        }
      }
      if (newStatus === TaskStatus.COMPLETED && this.isTaskToInventory(task)) {
          await this.updateInventoryWithTaskQuantity(task);
          await this.loggingService.log(`Task ${task.task_id}: Inventory ${task.end_location.location_id} set to AVAILABLE (task completed).`, task.task_type, task.task_id, null);
      }
    } catch (error) {
      this.logger.error(`Error handling inventory updates for task ${task.task_id}:`, error.message);
    }
  }

  private isTaskFromInventory(task: Task): boolean {
    // Check if start_location has inventory attribute
    return task.start_location?.location_attribute?.attribute_value === 'inventory';
  }

  private isTaskToInventory(task: Task): boolean {
    // Check if end_location has inventory attribute
    return task.end_location?.location_attribute?.attribute_value === 'inventory';
  }

  private async updateInventoryWithTaskQuantity(task: Task): Promise<void> {
    const inventoryLocationId = task.end_location.location_id;
    const inventory = await this.inventoryRepository.findOne({
      where: {
        id: inventoryLocationId,
      }
    });
    if (!inventory) {return;}
    await this.inventoryRepository.update(
      { 
        id: inventoryLocationId,
      },
      {
        status: LocationStatus.AVAILABLE,
        isProcessing: false,
        holded_by: null,
      }
    );
  }

  private async handleStationStatusUpdates(task: Task, newStatus: TaskStatus): Promise<void> {

    if (newStatus === TaskStatus.PROCESSING && task.start_location.location_attribute?.attribute_value === 'station'
      && task.start_location.location_id !== task.end_location.location_id
    ) {
      // When task status becomes PROCESSING and source is station - mark station as OCCUPIED
      const stationId = task.start_location.location_id;
      await this.orchestratorService.releaseStation(stationId);
      await this.loggingService.log(`Task ${task.task_id}: Marking station ${stationId} as AVAILABLE.`, TaskType.GOODS_TO_PERSON, task.task_id, null);
    }

    // When task status becomes COMPLETED and destination is station - mark station as OCCUPIED
    if (newStatus === TaskStatus.COMPLETED && 
        task.end_location?.location_attribute?.attribute_value === 'station') {

      const stationId = task.end_location.location_id;
      await this.loggingService.log(`Task ${task.task_id}: Marking station ${stationId} as OCCUPIED.`, TaskType.GOODS_TO_PERSON, task.task_id, null);
      
      await this.stationRepository.update(
        { station_id: stationId },
        { 
          status: LocationStatus.OCCUPIED,
          holded_by: task.task_id
        }
      );
    }
  }

  private async handleWaitingLocationStatusUpdates(task: Task, newStatus: TaskStatus): Promise<void> {
    // When task status becomes PROCESSING and source location is waiting_location - mark waiting location as AVAILABLE
    if (newStatus === TaskStatus.PROCESSING && 
        task.start_location?.location_attribute?.attribute_value === 'waiting_location'
        && task.start_location.location_id !== task.end_location.location_id
      ) {
      
      const waitingLocationId = task.start_location.location_id;
      this.logger.log(`Marking waiting location ${waitingLocationId} as AVAILABLE and clearing holded_by (task ${task.task_id} processing)`);
      
      await this.waitingLocationRepository.update(
        { location_id: waitingLocationId },
        { 
          status: LocationStatus.AVAILABLE,
          holded_by: null
        }
      )
      await this.loggingService.log(`Task ${task.task_id}: Marking waiting location ${waitingLocationId} as AVAILABLE.`, TaskType.GOODS_TO_PERSON, task.task_id, null);
    }

    // When task status becomes COMPLETED and destination is waiting_location - mark waiting location as OCCUPIED
    if (newStatus === TaskStatus.COMPLETED && 
        task.end_location?.location_attribute?.attribute_value === 'waiting_location') {
      
      const waitingLocationId = task.end_location.location_id;
      this.logger.log(`Marking waiting location ${waitingLocationId} as OCCUPIED (task ${task.task_id} completed)`);
      this.loggingService.log(`Task ${task.task_id}: Marking waiting location ${waitingLocationId} as OCCUPIED.`, TaskType.GOODS_TO_PERSON, task.task_id, null);

      await this.waitingLocationRepository.update(
        { location_id: waitingLocationId },
        { 
          status: LocationStatus.OCCUPIED,
          holded_by: task.task_id
        }
      );
    }
  }
  
  // Compute and persist BaseOps batch status and aggregates so findAllBatches can avoid recalculation
  async updateBatchStatus(batchId: string, task_type: TaskType): Promise<void> {
    try {
      if (task_type === TaskType.CROSSDOCK) {
        // Crossdock: aggregate chain statuses per original task root (sequence_order = 0 preferred)
        let roots = await this.taskRepository.find({
          where: { batch_id: batchId, task_type, task_dependency: IsNull() },
          order: { created_at: 'ASC' },
        });
        const hasSeqZero = roots.some(r => r.sequence_order === 0);
        if (hasSeqZero) {
          roots = roots.filter(r => r.sequence_order === 0);
        }

        const rootAggregates: TaskStatus[] = [];
        for (const root of roots) {
          const chainStatuses = await this.collectCrossdockChainStatuses(batchId, root.task_id);
            // Reduce chain statuses to a single root aggregate
          rootAggregates.push(this.aggregateStatuses(chainStatuses));
        }
        const total_tasks = roots.length;
        const completed_tasks = rootAggregates.filter(s => s === TaskStatus.COMPLETED).length;
        const cancelled_tasks = rootAggregates.filter(s => s === TaskStatus.CANCELLED).length;
        const batchStatus = this.mapTaskToBatchStatus(this.aggregateStatuses(rootAggregates));

        await this.batchRepository.update(
          { batch_id: batchId },
          { status: batchStatus, total_tasks, completed_tasks, cancelled_tasks }
        );
        return;
      }

      // BaseOps / other task types: Use top-level tasks only (existing logic)
      const tasks = await this.taskRepository.find({
        where: {
          batch_id: batchId,
          task_type: task_type,
          task_dependency: IsNull(),
        },
        order: { created_at: 'DESC' },
      });

      const normalizedStatuses = await Promise.all(
        tasks.map(async (t) => {
          if (t.move_type === MOVE_TYPE.ZONE_TO_WAIT && t.status === TaskStatus.COMPLETED) {
            const hasDependent = await this.taskRepository.findOne({ where: { task_dependency: t.task_id } });
            return hasDependent ? hasDependent.status : TaskStatus.WAITING;
          }
          return t.status;
        })
      );

      const total_tasks = tasks.length;
      const completed_tasks = normalizedStatuses.filter((s) => s === TaskStatus.COMPLETED).length;
      const cancelled_tasks = normalizedStatuses.filter((s) => s === TaskStatus.CANCELLED).length;

      const nextStatus = this.aggregateBaseOpsBatch(normalizedStatuses);

      await this.batchRepository.update(
        { batch_id: batchId },
        { status: nextStatus, total_tasks, completed_tasks, cancelled_tasks }
      );
    } catch (err: any) {
      this.logger.error(`Failed to update BaseOps batch status for ${batchId}: ${err.message}`);
    }
  }

  // Crossdock chain status collection (fan-out BFS)
  private async collectCrossdockChainStatuses(batchId: string, rootTaskId: string): Promise<TaskStatus[]> {
    const statuses: TaskStatus[] = [];
    const visited = new Set<string>();
    let frontier: string[] = [rootTaskId];
    while (frontier.length > 0) {
      const dependents = await this.taskRepository.find({
        where: { task_dependency: In(frontier), batch_id: batchId, task_type: TaskType.CROSSDOCK },
        select: ['task_id', 'status'],
      });
      const newly: string[] = [];
      for (const d of dependents) {
        if (!visited.has(d.task_id)) {
          visited.add(d.task_id);
          statuses.push(d.status);
          newly.push(d.task_id);
        }
      }
      frontier = newly;
    }
    // Include root itself
    const root = await this.taskRepository.findOne({ where: { task_id: rootTaskId } });
    if (root) statuses.push(root.status);
    return statuses;
  }

  // Shared aggregation precedence (used for Crossdock root + batch aggregation)
  private aggregateStatuses(statuses: TaskStatus[]): TaskStatus {
    if (!statuses || statuses.length === 0) return TaskStatus.PENDING;
    const unique = new Set(statuses);
    if (unique.size === 1 && unique.has(TaskStatus.CANCELLED)) return TaskStatus.CANCELLED;
    if (unique.has(TaskStatus.PROCESSING)) return TaskStatus.PROCESSING;
    if (unique.has(TaskStatus.ASSIGNED) || unique.has(TaskStatus.INQUEUE)) return TaskStatus.ASSIGNED;
    if (unique.has(TaskStatus.PENDING) || unique.has(TaskStatus.HALTED) || unique.has(TaskStatus.WAITING)) return TaskStatus.PENDING;
    if (unique.has(TaskStatus.COMPLETED)) return TaskStatus.COMPLETED;
    return statuses[0];
  }

  // Existing BaseOps batch mapping preserved but extracted for clarity
  private aggregateBaseOpsBatch(normalizedStatuses: TaskStatus[]): BatchStatus {
    if (normalizedStatuses.every((s) => s === TaskStatus.CANCELLED)) {
      return BatchStatus.CANCELLED;
    }
    if (normalizedStatuses.length > 0 && normalizedStatuses.every((s) => s === TaskStatus.COMPLETED || s === TaskStatus.CANCELLED)) {
      return BatchStatus.COMPLETED;
    }
    if (normalizedStatuses.some((s) => s === TaskStatus.PROCESSING)) {
      return BatchStatus.PROCESSING;
    }
    if (normalizedStatuses.length > 0 && normalizedStatuses.every((s) => s === TaskStatus.COMPLETED || s === TaskStatus.WAITING)) {
      return BatchStatus.WAITING;
    }
    if (normalizedStatuses.some((s) => s === TaskStatus.HALTED)) {
      return BatchStatus.HALTED;
    }
    return BatchStatus.PENDING;
  }

  private mapTaskToBatchStatus(status: TaskStatus): BatchStatus {
    switch (status) {
      case TaskStatus.CANCELLED:
        return BatchStatus.CANCELLED;
      case TaskStatus.PROCESSING:
        return BatchStatus.PROCESSING;
      case TaskStatus.ASSIGNED:
      case TaskStatus.INQUEUE:
        // No explicit ASSIGNED in BatchStatus; reflect as IN_PROGRESS/PROCESSING? Keep PENDING/PROCESSING precedence handled earlier.
        return BatchStatus.IN_PROGRESS;
      case TaskStatus.PENDING:
      case TaskStatus.HALTED:
        return BatchStatus.HALTED;
      case TaskStatus.WAITING:
        return BatchStatus.PENDING;
      case TaskStatus.COMPLETED:
        return BatchStatus.COMPLETED;
      default:
        return BatchStatus.PENDING;
    }
  }

  private async addRobotIfNotExists(robotId: string, taskType: TaskType): Promise<void> {
    try {
      const existingRobot = await this.robotRepository.findOne({ where: { robot_id: robotId } });
      if (!existingRobot) {
        const newRobot = new Robot();
        newRobot.robot_id = robotId;
        newRobot.task_type = taskType;
        await this.robotRepository.save(newRobot);
        this.logger.log(`Added new robot ${robotId} of type ${taskType} to the system.`);
        await this.loggingService.log(`Added new robot ${robotId} of type ${taskType} to the system.`, taskType, null, null);
      }
    } catch (error) {
      this.logger.error(`Failed to add robot ${robotId}: ${error.message}`);
    }
  
  }

  private async updateRobotUsage(robotId: string, inUse: boolean): Promise<void> {
    try {
      if (!robotId) { return; }
      const robot = await this.robotRepository.findOne({ where: { robot_id: robotId } });
      if (robot) {
        if (robot.status === (inUse ? RobotStatus.INUSE : RobotStatus.ONLINE)) { return; } // No change needed
        if (!robot.logs){
          robot.logs = [];
        }
        robot.logs.push({
          timestamp: new Date(),
          previous_status: robot.status,
          new_status: inUse ? RobotStatus.INUSE : RobotStatus.ONLINE,
        });
        robot.status = inUse ? RobotStatus.INUSE : RobotStatus.ONLINE;
        await this.robotRepository.save(robot);
        this.logger.log(`Robot ${robotId} status set to ${robot.status}`);
        await this.loggingService.log(`Robot ${robotId} status set to ${robot.status}`, robot.task_type, null, null);
      }
    } catch (error) {
      this.logger.error(`Failed to update robot ${robotId} status: ${error.message}`);
    }
  }

  // Crossdock cancellation handling
  private async handleCrossdockCancellation(task: Task): Promise<void> {
    try {
      await this.CrossdockTaskService.taskService.markSystemAsWaiting()
      // Gate: only act if there exists any CROSSDOCK task with lower priority than current

      if (task.move_type === MOVE_TYPE.PICK_ENTRY) {
        const lowerPriorityTasks = await this.taskRepository.find({
          where: {
            task_type: TaskType.CROSSDOCK,
            priority: LessThan(task.priority ?? Number.MAX_SAFE_INTEGER),
            move_type: MOVE_TYPE.PICK_ENTRY,
            status: Not(In([TaskStatus.CANCELLED, TaskStatus.COMPLETED]))
          }
        });

        const validLowerPriorityTasks = lowerPriorityTasks.filter(t => t.start_location.location_id === task.start_location.location_id);

        if(validLowerPriorityTasks.length > 0) {
          await this.CrossdockTaskService.taskService.handleCrossdockPickEntryCancellation(task) as string;

          const dropLocationAffectedTasks = await this.taskRepository.find({
            where: {
              task_type: TaskType.CROSSDOCK,
              priority: LessThan(task.priority ?? Number.MAX_SAFE_INTEGER),
              move_type: MOVE_TYPE.PICK_ENTRY,
              status: In([TaskStatus.ASSIGNED, TaskStatus.INQUEUE, TaskStatus.PROCESSING])
            }
          });

          for (const affectedTask of dropLocationAffectedTasks) {
            await this.CrossdockTaskService.taskService.handleCrossdockPickEntryCancellation(affectedTask);
          }
        }
      } 
      else if (task.move_type === MOVE_TYPE.ZONE_TO_DROP_ENTRY) {
        await this.CrossdockTaskService.taskService.handleCrossdockDropEntryCancellation(task);
      }
    } catch (err: any) {
      this.logger.error(`Crossdock internal cancellation handling failed for ${task.task_id}: ${err.message}`);
      await this.loggingService.createErrorLog(
        `Crossdock internal cancellation handling failed: ${err.message}`,
        TaskType.CROSSDOCK,
        task.task_id,
        task.batch_id ?? null,
        true,
      );
    } finally {
      await this.CrossdockTaskService.taskService.unmarkSystemAsWaiting();
    }
  }
}
