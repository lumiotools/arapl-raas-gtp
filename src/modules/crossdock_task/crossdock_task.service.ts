import { BadRequestException, Inject, Injectable, forwardRef } from '@nestjs/common';
import { TaskService } from '../tasks/tasks.service';
import { WMSBatchJob, WMSBatchJobStatus } from '../wms_integration_wrapper/entities/batch_job';
import { BatchStatus, LocationType, TaskStatus } from 'src/entities';
import { WMSBatchJobTaskLocationAction, WMSBatchJobTaskLocationType } from '../wms_integration_wrapper/entities/batch_job_task_location';
import { WMSBatchJobTaskStatus, WMSBatchJobTaskType } from '../wms_integration_wrapper/entities/batch_job_task';
// Removed unused imports after simplifying flow (no merge with existing DB tasks)

@Injectable()
export class CrossdockTaskService {
  constructor(
    @Inject(forwardRef(() => TaskService))
    readonly taskService: TaskService,
  ) {}

  async findAllBatches() {
   return await this.taskService.findAllBatches()
  }

  async findBatchTasks(batch_id: string) {
   return await this.taskService.findBatchTasks(batch_id);
  }

  async findBatchTasksActivities(batch_id: string, task_id: string) {
   return await this.taskService.findBatchTasksActivities(batch_id, task_id);
  }

  async processTasks(tasks: any[], priority: number, batch_job_id?: string): Promise<any> {
    // ===== VALIDATION SECTION =====
    const validationErrors: string[] = [];
    const startLocationIds = new Set<string>();
    const palletEndLocationIds = new Set<string>();

    for (const task of tasks) {
      console.log(`tasks: ${JSON.stringify(task)}`);
      const rowNum = task._rowNumber;

      
      // 1. Validate start_location_type is always PALLET
      if (task['start_location_location_type'] !== 'PALLET') {
        validationErrors.push(`Start Location must be 'PALLET', found '${task['start_location_location_type']}'`);
      }

      // 2. Check for duplicate start_location_ids
      const startLocationId = task['start_location_location_id'];
      if (!startLocationId) {
        validationErrors.push(`Start Location ID is required`);
      } else if (startLocationIds.has(startLocationId)) {
        validationErrors.push(`Duplicate Start Location ID '${startLocationId}' found`);
      } else {
        startLocationIds.add(startLocationId);
      }

      // 3. Validate end_location_type is either PALLET or ZONE
      const endLocationType = task['end_location_location_type'];
      if (endLocationType !== 'PALLET' && endLocationType !== 'ZONE') {
        validationErrors.push(`End Location must be 'PALLET' or 'ZONE', found '${endLocationType}'`);
      }

      // 4. Check for duplicate pallet end_location_ids
      const endLocationId = task['end_location_location_id'];
      if (!endLocationId) {
        validationErrors.push(`End Location ID is required`);
      } else if (endLocationType === 'PALLET') {
        if (palletEndLocationIds.has(endLocationId)) {
          validationErrors.push(`Duplicate pallet End Location ID '${endLocationId}' found`);
        } else {
          palletEndLocationIds.add(endLocationId);
        }
      }

      // 7. Check if the start and end location ids exist in the system and they are available
      const startLocationValid = await this.taskService.LocationManagerService.isValidLocationId(startLocationId, true);
      if (!startLocationValid) {
        validationErrors.push(`Start Location '${startLocationId}' is not available or does not exist in the system`);
      }
      const OtherTaskWithStartLocation = await this.taskService.LocationManagerService.otherTaskWithStartLocation(startLocationId);
      if (OtherTaskWithStartLocation){
        validationErrors.push(`Start Location '${startLocationId}' is already assigned to another pending task`);
      }

    }
    console.log(`Validation completed with ${validationErrors.length} errors.`);
    // If there are validation errors, throw them
    if (validationErrors.length > 0) {
      throw new BadRequestException(validationErrors.join('\n'));
    }

    // Remove the temporary row number field before processing
    tasks.forEach(task => delete task._rowNumber);

    // Resolve all pick/drop priorities first (cannot use async comparator in Array.sort)
    const pickPriorities = await Promise.all(
      tasks.map(t => this.taskService.LocationManagerService.getPickPriority(t['start_location_location_id']))
    );
    const dropPriorities = await Promise.all(
      tasks.map(t => t['end_location_location_type'] === "PALLET" ? this.taskService.LocationManagerService.getDropPriority(t['end_location_location_id']) : undefined)
    );

    // Assign pick/drop priority to each task for sorting/validation
    tasks.forEach((t, i) => {
      (t as any).priority = pickPriorities[i];
      (t as any)._pickPriority = pickPriorities[i];
      (t as any)._dropPriority = dropPriorities[i];
    });

    // Ensure every task has a valid pick priority
    const missingPick = tasks
      .map((t, i) => ({ id: t['start_location_location_id'], p: (t as any)._pickPriority }))
      .filter(x => x.p == null)
      .map(x => x.id);
    if (missingPick.length > 0) {
      throw new BadRequestException(`Missing pick priority for start locations: ${missingPick.join(', ')}`);
    }

    tasks.sort((a, b) => {
      const pa = (a as any)._pickPriority || 0;
      const pb = (b as any)._pickPriority || 0;
      if (pa !== pb) return pa - pb;

      const aIsPallet = a['end_location_location_type'] === 'PALLET';
      const bIsPallet = b['end_location_location_type'] === 'PALLET';

      const da = aIsPallet ? ((a as any)._dropPriority ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
      const db = bIsPallet ? ((b as any)._dropPriority ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;

      return da - db;
    });

    // Validate drop locations direct accessibility using LocationManagerService
    // Build ordered list of end pallet IDs only
    const endPalletIds: string[] = tasks
      .filter(t => t['end_location_location_type'] === 'PALLET')
      .map(t => t['end_location_location_id']);

    if (endPalletIds.length > 0) {
      const accessibility = await this.taskService.LocationManagerService.checkDropLocationsDirectAccessibility(endPalletIds);
      const blockedIds = endPalletIds.filter((id, idx) => !accessibility[idx]);
      if (blockedIds.length > 0) {
        // clean up temporary fields before throwing
        tasks.forEach(t => {
          delete (t as any)._pickPriority;
          delete (t as any)._dropPriority;
        });
        throw new BadRequestException(`Drop locations not directly accessible in sequence: ${blockedIds.join(', ')}`);
      }
    }

    // Clean temporary fields from tasks before proceeding (we don't merge with DB tasks)
    tasks.forEach(t => {
      delete (t as any)._pickPriority;
      delete (t as any)._dropPriority;
    });

    // Occupy start locations for these new tasks
    for (const task of tasks) {
      await this.taskService.LocationManagerService.occupyLocation(task['start_location_location_id']);
    }

    // Process only the provided tasks without merging with existing DB tasks
    return await this.taskService.processTasks(tasks, priority, batch_job_id);
  }

  async setInitialConfiguration(): Promise<void> {
    // Use generic taskService to ensure robot counters/configuration are setup
    await this.taskService.setInitialConfiguration();
  }

  async getManualTaskStartLocation(){
    // Prefer generic location manager via taskService
    return await this.taskService.getManualTaskStartLocation();
  }

  async getManualTaskEndLocation(){
    return await this.taskService.getManualTaskEndLocation();
  }

  async cancelTask(task_id: string): Promise<any> {
   return await this.taskService.cancelTask(task_id);
  }

  async createWMSBatchJob(batch_job: WMSBatchJob): Promise<string> {
    const crossdock_tasks: any[] = []

    batch_job.tasks.forEach((task)=> {
      crossdock_tasks.push({
        wms_task_id: task.task_id,
        start_location_location_type: task.start_location.location_type,
        start_location_location_id: task.start_location.location_id,
        end_location_location_type: task.end_location.location_type,
        end_location_location_id: task.end_location.location_id,
        barcode_number: task.cargos.length > 0 ? task.cargos[0].cargo_code : '',
        priority: 1,
      })
    })

    try {
      const { batch_id } = await this.processTasks(crossdock_tasks, 3, batch_job.batch_job_id);
      return batch_id as string;
    } catch (error) {
      throw new BadRequestException(`Failed to create batch job: ${error.message}`);
    }
  }

  async getWMSBatchJob(wms_batch_id: string): Promise<WMSBatchJob> {
    
    const crossdock_batch = await this.taskService.batchRepository.findOne({
      where: { wms_batch_id: wms_batch_id },
    });

    if (!crossdock_batch) {
      throw new BadRequestException(`Batch with ID '${wms_batch_id}' not found`);
    }
    
    const tasks =  await this.findBatchTasks(crossdock_batch.batch_id);

    const batch_job_tasks: WMSBatchJob["tasks"] = []

    for (const task of tasks) {
      const final_end_location = (task as any).final_end_location || task.end_location;
      let task_status = WMSBatchJobTaskStatus.TASK_ACKNOWLEDGED;

      if(task.robot_id) task_status = WMSBatchJobTaskStatus.ROBOT_ASSIGNED;
      if(task.status === TaskStatus.PROCESSING) task_status = WMSBatchJobTaskStatus.PICKUP_SUCCESSFUL;
      if(task.status === TaskStatus.COMPLETED) task_status = WMSBatchJobTaskStatus.TASK_COMPLETED;
      if(task.status === TaskStatus.CANCELLED) task_status = WMSBatchJobTaskStatus.TASK_CANCELLED;

      batch_job_tasks.push({
        task_id: task.wms_task_id || task.task_id,
        task_type: WMSBatchJobTaskType.CROSSDOCK,
        status: task_status,
        start_location: {
          location_id: task.start_location.display_name!,
          location_type: task.start_location.location_type === LocationType.PALLET ? WMSBatchJobTaskLocationType.PALLET : WMSBatchJobTaskLocationType.ZONE,
          location_action: WMSBatchJobTaskLocationAction.PICK,
          location_dimension: {
            length: task.start_location.location_dimension?.length!,
            width: task.start_location.location_dimension?.width!,
            height: task.start_location.location_dimension?.height!,
          },
        },
        end_location: {
          location_id: final_end_location.display_name!,
          location_type: final_end_location.location_type === LocationType.PALLET ? WMSBatchJobTaskLocationType.PALLET : WMSBatchJobTaskLocationType.ZONE,
          location_action: WMSBatchJobTaskLocationAction.DROP,
          location_dimension: {
            length: final_end_location.location_dimension?.length!,
            width: final_end_location.location_dimension?.width!,
            height: final_end_location.location_dimension?.height!,
          },
        },
        cargos: task.cargos?.map(cargo => ({
          cargo_code: cargo.cargo_code,
        })) || [],
      })
    }

    let batch_job_status = WMSBatchJobStatus.TASK_ACKNOWLEDGED;

    if([BatchStatus.IN_PROGRESS, BatchStatus.PROCESSING].includes(crossdock_batch?.status!)) batch_job_status = WMSBatchJobStatus.TASK_IN_PROGRESS;
    if(crossdock_batch?.status === BatchStatus.CANCELLED) batch_job_status = WMSBatchJobStatus.TASK_CANCELLED;
    if(crossdock_batch?.status === BatchStatus.COMPLETED) batch_job_status = WMSBatchJobStatus.TASK_COMPLETED;

    const batch_job: WMSBatchJob = {
      batch_job_id: wms_batch_id,
      batch_job_status: batch_job_status,
      tasks: batch_job_tasks,
    }

    return batch_job;

  }
}