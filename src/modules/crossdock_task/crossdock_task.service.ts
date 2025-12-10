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
      const startLocation = await this.taskService.LocationManagerService.getLocation(startLocationId);
      const startZoneId = startLocation?.parent_id || startLocation?.location_id;

      if (!startLocationId) {
        validationErrors.push(`Start Location ID is required`);
      } else if (startLocationIds.has(startLocationId)) {
        validationErrors.push(`Duplicate Start Location ID '${startLocation?.display_name}' found`);
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
      const endLocation = await this.taskService.LocationManagerService.getLocation(endLocationId);
      const endZoneId = endLocation?.parent_id || endLocation?.location_id;
      if (!endLocationId) {
        validationErrors.push(`End Location ID is required`);
      } else if (endLocationType === 'PALLET') {
        if (palletEndLocationIds.has(endLocationId)) {
          validationErrors.push(`Duplicate pallet End Location ID '${endLocation?.display_name}' found`);
        } else {
          palletEndLocationIds.add(endLocationId);
        }
      }

      // 7. Check if the start and end location ids exist in the system and they are available
      const startLocationValid = await this.taskService.LocationManagerService.isValidLocationId(startLocationId, true);
      if (!startLocationValid) {
        validationErrors.push(`Start Location '${startLocation?.display_name}' is not available or does not exist in the system`);
      }
      const OtherTaskWithStartLocation = await this.taskService.LocationManagerService.otherTaskWithStartLocation(startLocationId);
      if (OtherTaskWithStartLocation){
        validationErrors.push(`Start Location '${startLocation?.display_name}' is already assigned to another pending task`);
      }

      if (endLocationType === 'PALLET') {
        const endLocationValid = await this.taskService.LocationManagerService.isValidLocationId(endLocationId, false);
        if (!endLocationValid) {
          validationErrors.push(`End Location '${endLocation?.display_name}' is not available or does not exist in the system`);
        }
      }

      
      

      const zonePairId = await this.taskService.LocationManagerService.getZonePairId(startZoneId!, endZoneId!);

      if(!zonePairId) {
        validationErrors.push(`Task cannot be created from Start Location '${startLocation?.display_name}' to End Location '${endLocation?.display_name}'.`);
      }
    }
    console.log(`Validation completed with ${validationErrors.length} errors.`);
    // If there are validation errors, throw them
    if (validationErrors.length > 0) {
      throw new BadRequestException(validationErrors.join('\n'));
    }

    // Remove the temporary row number field before processing
    tasks.forEach(task => delete task._rowNumber);

    const startLocation = (await this.taskService.LocationManagerService.getLocation(tasks[0]['start_location_location_id']));
    const startZoneId = startLocation?.parent_id || startLocation?.location_id;
    const endLocation = (await this.taskService.LocationManagerService.getLocation(tasks[0]['end_location_location_id']));
    const endZoneId = endLocation?.parent_id || endLocation?.location_id;

    const zonePairId = await this.taskService.LocationManagerService.getZonePairId(startZoneId!, endZoneId!);

    // Fetch start zone and check if partial pick is allowed
    const startZone = await this.taskService.LocationManagerService.getLocation(startZoneId!);
    const allowPartialPick = startZone?.attributes?.find((a: any) => a.attribute_name === 'allow_partial_pick')?.attribute_value ?? false;

    const isPickPriorityReversed = zonePairId ? await this.taskService.LocationManagerService.isPickPriorityReversed(zonePairId) : false;
    const isDropPriorityReversed = zonePairId ? await this.taskService.LocationManagerService.isDropPriorityReversed(zonePairId) : false;

    // Resolve all pick/drop priorities first (cannot use async comparator in Array.sort)
    let pickPriorities: (number | null)[] = [];
    if (isPickPriorityReversed) {
      // When reversed mode is enabled, get a reversed mapping from LocationManagerService
      pickPriorities = await Promise.all(
        tasks.map(t => this.taskService.LocationManagerService.getReversePickPriority(t['start_location_location_id']))
      );
    } else {
      pickPriorities = await Promise.all(
        tasks.map(t => this.taskService.LocationManagerService.getPickPriority(t['start_location_location_id']))
      );
    }

    let dropPriorities: (number | null | undefined)[] = [];
    if (isDropPriorityReversed) {
      dropPriorities = await Promise.all(
        tasks.map(t => t['end_location_location_type'] === "PALLET" ? this.taskService.LocationManagerService.getReverseDropPriority(t['end_location_location_id']) : undefined)
      );
    } else {
      dropPriorities = await Promise.all(
        tasks.map(t => t['end_location_location_type'] === "PALLET" ? this.taskService.LocationManagerService.getDropPriority(t['end_location_location_id']) : undefined)
      );
    }

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

    // Validate pick locations direct accessibility using LocationManagerService
    const startPalletIds: string[] = tasks.map(t => t['start_location_location_id']);
    let tasksWithBlockingPicks: any[] = [];
    
    if (startPalletIds.length > 0) {
      const pickAccessibility = await this.taskService.LocationManagerService.checkPickLocationsDirectAccessibility(startPalletIds, false, zonePairId);
      const blockedPickIds = startPalletIds.filter((id, idx) => !pickAccessibility.accessible[idx]);
      if (blockedPickIds.length > 0) {
        // Only throw error if partial pick is not allowed
        if (!allowPartialPick) {
          // Build detailed error message with all blocking locations
          const errorMessage = pickAccessibility.blockingLocations.length > 0
            ? `Pick locations not directly accessible: ${blockedPickIds.join(', ')} (blocked by: ${pickAccessibility.blockingLocations.join(', ')})`
            : `Pick locations not directly accessible: ${blockedPickIds.join(', ')}`;
          
          // clean up temporary fields before throwing
          tasks.forEach(t => {
            delete (t as any)._pickPriority;
            delete (t as any)._dropPriority;
          });
          throw new BadRequestException(errorMessage);
        } else {
          // Partial pick is allowed - fetch blocking locations and sort by pick priority
          const blockingLocations = await Promise.all(
            pickAccessibility.blockingLocations.map(id => 
              this.taskService.LocationManagerService.getLocation(id)
            )
          );
          
          // Filter out null values and sort by pick priority (considering reversal)
          const validBlockingLocations = blockingLocations.filter(loc => loc !== null);
          validBlockingLocations.sort((a, b) => {
            const pa = a!.pick_priority ?? Number.MAX_VALUE;
            const pb = b!.pick_priority ?? Number.MAX_VALUE;
            return isPickPriorityReversed ? pb - pa : pa - pb;
          });
          
          // Get optimal wait location for each blocking location and prepare tasks
          for (const blockingLocation of validBlockingLocations) {
            const waitLocationId = await this.taskService.LocationManagerService.getOptimalWaitLocation(
              blockingLocation.location_id,
              zonePairId!
            );
            
            if (!waitLocationId) {
              // Skip this blocking location if no wait location available
              continue;
            }

            const waitLocation = await this.taskService.LocationManagerService.getLocation(waitLocationId);
            const waitZoneId = waitLocation?.parent_id!;

            await this.taskService.LocationManagerService.reserveLocation(waitLocationId);
            
            // Create blocking task object and add to array
            tasksWithBlockingPicks.push({
              start_location_location_type: 'PALLET',
              start_location_location_id: blockingLocation.location_id,
              end_location_location_type: 'PALLET',
              end_location_location_id: waitLocationId,
              end_location_zone_id: waitZoneId,
              barcode_number: '',
              priority: isPickPriorityReversed 
              ? await this.taskService.LocationManagerService.getReversePickPriority(blockingLocation.location_id) 
              : await this.taskService.LocationManagerService.getPickPriority(blockingLocation.location_id),
            });
          }
          
          // Check if we found enough wait locations for all blocking locations
          if (tasksWithBlockingPicks.length !== validBlockingLocations.length) {
            // clean up temporary fields before throwing
            tasks.forEach(t => {
              delete (t as any)._pickPriority;
              delete (t as any)._dropPriority;
            });
            throw new BadRequestException(
              `Insufficient wait locations available. Required: ${validBlockingLocations.length}, Found: ${tasksWithBlockingPicks.length}`
            );
          }
        }
      }
    }

    // Validate drop locations direct accessibility using LocationManagerService
    // Build ordered list of end pallet IDs only
    const endPalletIds: string[] = tasks
      .filter(t => t['end_location_location_type'] === 'PALLET')
      .map(t => t['end_location_location_id']);

    if (endPalletIds.length > 0) {
      const accessibility = await this.taskService.LocationManagerService.checkDropLocationsDirectAccessibility(endPalletIds, false, zonePairId);
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
    
    // Check if partial pick scenario exists
    if (tasksWithBlockingPicks.length > 0) {
      const reverseTasksForBlockingPicks: any[] = []

      for (const t of tasksWithBlockingPicks) {
        const reverseTaskZonePairId = await this.taskService.LocationManagerService.getZonePairId(
          t.end_location_zone_id,
          startZoneId!,
        );
        const reverseTaskIsPickPriorityReversed = await this.taskService.LocationManagerService.isPickPriorityReversed(reverseTaskZonePairId!);

        reverseTasksForBlockingPicks.push({
          start_location_location_type: 'PALLET',
          start_location_location_id: t.end_location_location_id,
          end_location_location_type: 'ZONE',
          end_location_location_id: startZoneId,
          barcode_number: '',
          priority: reverseTaskIsPickPriorityReversed 
          ? await this.taskService.LocationManagerService.getReversePickPriority(t.end_location_location_id) 
          : await this.taskService.LocationManagerService.getPickPriority(t.end_location_location_id),
        })
      }
      
      // Occupy start locations for blocking-to-wait tasks
      for (const task of tasksWithBlockingPicks) {
        await this.taskService.LocationManagerService.occupyLocation(task.start_location_location_id);
      }
      
      // Occupy start locations for user's requested tasks
      for (const task of tasks) {
        await this.taskService.LocationManagerService.occupyLocation(task['start_location_location_id']);
      }
      // Process all three sets of tasks in sequence
      const { batch_id: blocking_batch_id } = await this.taskService.processTasks(tasksWithBlockingPicks, priority, batch_job_id);
      const userTasksResult = await this.taskService.processTasks(tasks, priority, batch_job_id, blocking_batch_id);
      await this.taskService.processTasks(reverseTasksForBlockingPicks, priority, batch_job_id, userTasksResult.batch_id);
      return userTasksResult;
    }
    
    // Normal scenario: no blocking locations
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
    // Collect all unique location IDs to fetch in parallel
    const locationIdsToFetch = new Set<string>();
    
    for (const task of batch_job.tasks) {
      if (task.start_location.location_id) {
        locationIdsToFetch.add(task.start_location.location_id);
      }
      if (task.end_location.location_id) {
        locationIdsToFetch.add(task.end_location.location_id);
      }
    }

    // Fetch all locations in parallel and build a cache
    const locationCache = new Map<string, any>();
    
    await Promise.all(
      Array.from(locationIdsToFetch).map(async (locationId) => {
        let location = await this.taskService.LocationManagerService.getLocation(locationId);
        if (!location) {
          location = await this.taskService.LocationManagerService.getLocationByDisplayName(locationId);
        }
        if (location) {
          locationCache.set(locationId, location);
        }
      })
    );

    // Build crossdock tasks using cached locations
    const crossdock_tasks: any[] = batch_job.tasks.map((task) => {
      // Update task location IDs based on cache
      const startLocation = task.start_location.location_id 
        ? locationCache.get(task.start_location.location_id) 
        : null;
      const endLocation = task.end_location.location_id 
        ? locationCache.get(task.end_location.location_id) 
        : null;

      return {
        wms_task_id: task.task_id,
        start_location_location_type: task.start_location.location_type,
        start_location_location_id: startLocation?.location_id || task.start_location.location_id,
        end_location_location_type: task.end_location.location_type,
        end_location_location_id: endLocation?.location_id || task.end_location.location_id,
        barcode_number: task.cargos.length > 0 ? task.cargos[0].cargo_code : '',
        priority: 1,
      };
    });

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

      if(task.robot_id) task_status = WMSBatchJobTaskStatus.TASK_ACKNOWLEDGED;
      if(task.status === TaskStatus.PROCESSING) task_status = WMSBatchJobTaskStatus.PICKUP_SUCCESSFUL;
      if(task.status === TaskStatus.ASSIGNED) task_status = WMSBatchJobTaskStatus.ROBOT_ASSIGNED;
      if(task.status === TaskStatus.COMPLETED && task.end_location?.location_attribute?.attribute_pending_next_intermediate_task) task_status = WMSBatchJobTaskStatus.DROP_SUCCESSFUL;
      if(task.status === TaskStatus.COMPLETED && !task.end_location?.location_attribute?.attribute_pending_next_intermediate_task) task_status = WMSBatchJobTaskStatus.TASK_COMPLETED;
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
    if(crossdock_batch?.status === BatchStatus.HALTED) batch_job_status = WMSBatchJobStatus.TASK_IN_PROGRESS;
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