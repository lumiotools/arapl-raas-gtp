import { BadRequestException, Inject, Injectable, forwardRef } from '@nestjs/common';
import { TaskService } from '../tasks/tasks.service';
import { TaskStatus, TaskType } from 'src/entities';
import { In } from 'typeorm';
import { MOVE_TYPE } from 'src/entities/task.entity';

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

  async processTasks(tasks: any[], priority: number): Promise<any> {
    // ===== VALIDATION SECTION =====
    const validationErrors: string[] = [];
    const startLocationIds = new Set<string>();
    const palletEndLocationIds = new Set<string>();

    for (const task of tasks) {
      console.log(`tasks: ${JSON.stringify(task)}`);
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
      throw new BadRequestException(`Data Validation Failed:\n${validationErrors.join('\n')}`);
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
      (t as any)._pickPriority = pickPriorities[i];
      (t as any)._dropPriority = dropPriorities[i];
    });

    // const pickPriorityValues = pickPriorities.filter(p => p != null);
    // if (pickPriorityValues.length > 0) {
    //   const maxPick = Math.max(...pickPriorityValues);
    //   // Ensure all start locations are in the same zone (parent_id)
    //   const startLocationIdsForExclusion = tasks.map(t => t['start_location_location_id']).filter(Boolean);
    //   const startLocations = await Promise.all(startLocationIdsForExclusion.map(id => this.taskService.LocationManagerService.getLocation(id)));
    //   const parentIds = Array.from(new Set(startLocations.map(s => s?.parent_id).filter(Boolean)));
    //   if (parentIds.length > 1) {
    //     // clean up temporary fields
    //     tasks.forEach(t => {
    //       delete (t as any)._pickPriority;
    //       delete (t as any)._dropPriority;
    //     });
    //     throw new BadRequestException('All start locations must belong to the same zone');
    //   }

    //   const baselineMinPick = 1; // P1 is always the baseline
    //   const zoneIdToCheck = parentIds.length === 1 ? parentIds[0] : undefined;
    //     // Use simple column-based check: ensure lower rows in same column are available
    //     const blockedByColumn = await this.taskService.LocationManagerService.findInaccessibleStartLocations(startLocationIdsForExclusion, baselineMinPick, maxPick, zoneIdToCheck);
    //     if (blockedByColumn && blockedByColumn.length > 0) {
    //       const blockedIds = blockedByColumn.map(b => b.location_id);
    //       // clean up temporary fields
    //       tasks.forEach(t => {
    //         delete (t as any)._pickPriority;
    //         delete (t as any)._dropPriority;
    //       });
    //       throw new BadRequestException(`Pick locations (${blockedIds.join(', ')}) not directly accessible`);
    //     }
    // }

    // Sort by pick priority (ascending). If pick priorities are equal, tie-break by drop priority (ascending).
    // For tasks whose end location is not a PALLET or drop priority is undefined, treat drop priority as Infinity
    // so they come after tasks with defined (lower) drop priorities.
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

    // assign ascending priority starting at 1
    tasks.forEach((t, i) => {
      (t as any).priority = i + 1;
    });

    // Validate that drop priorities (for PALLET drops) are non-decreasing in the pick-sorted order.
    // If they are not, some drop locations may not be directly accessible from the chosen sequence.
    const dropOrderErrors: string[] = [];
    let lastDropPriority: number | undefined = undefined;
    for (const t of tasks) {
      if (t['end_location_location_type'] === 'PALLET') {
        const dp = (t as any)._dropPriority;
        if (dp === undefined || dp === null) {
          dropOrderErrors.push(t['end_location_location_id']);
        } else {
          if (lastDropPriority === undefined) {
            lastDropPriority = dp;
          } else {
            if (dp < lastDropPriority) {
              dropOrderErrors.push(t['end_location_location_id']);
            } else {
              lastDropPriority = dp;
            }
          }
        }
      }
    }

    if (dropOrderErrors.length > 0) {
      // clean up temporary fields before throwing
      tasks.forEach(t => {
        delete (t as any)._pickPriority;
        delete (t as any)._dropPriority;
      });
      throw new BadRequestException(`Drop locations (${dropOrderErrors.join(', ')}) will not be directly accessible`);
    }

    const crossdockTasks = await this.taskService.taskRepository.find({
      where: {
      task_type: TaskType.CROSSDOCK,
      move_type: MOVE_TYPE.ZONE_TO_ZONE,
      status: In([TaskStatus.HALTED, TaskStatus.PENDING])
      },
    });

    // fetch pick priorities for db tasks
    const crossdockTasksPickPriorities = await Promise.all(
      crossdockTasks.map(t => this.taskService.LocationManagerService.getPickPriority(t.start_location.location_id))
    );
    crossdockTasks.forEach((t, i) => {
      (t as any)._pickPriority = crossdockTasksPickPriorities[i];
      (t as any)._isNew = false;
    });

    // mark new tasks so we can combine and sort together
    tasks.forEach(t => {
      (t as any)._isNew = true;
      // tasks already have _pickPriority set earlier
    });

    // combine DB tasks and new tasks, sort by pick priority and assign global priorities
    const combined = [...crossdockTasks, ...tasks];
    combined.sort((a, b) => {
      const pa = (a as any)._pickPriority ?? Number.POSITIVE_INFINITY;
      const pb = (b as any)._pickPriority ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;

      // tie-break deterministically: prefer existing DB tasks before new tasks, then by id if available
      if ((a as any)._isNew !== (b as any)._isNew) return (a as any)._isNew ? 1 : -1;
      const aid = (a as any).id ?? '';
      const bid = (b as any).id ?? '';
      return aid.toString().localeCompare(bid.toString());
    });

    combined.forEach((t, i) => {
      (t as any).priority = i + 1;
    });

    // prepare DB tasks to be saved with updated priorities
    const updatedDbTasks = combined
      .filter(t => !(t as any)._isNew)
      .map(t => {
      delete (t as any)._isNew;
      delete (t as any)._pickPriority;
      return t as any;
      });

    // clean temporary fields from new tasks (they are the original objects in `tasks`)
    tasks.forEach(t => {
      delete (t as any)._isNew;
      delete (t as any)._pickPriority;
      delete (t as any)._dropPriority;
    });

    // persist priority updates for DB tasks
    await this.taskService.taskRepository.save(updatedDbTasks);

    await tasks.forEach(async (task) => {
      await this.taskService.LocationManagerService.occupyLocation(task['start_location_location_id']);
    });

   return this.taskService.processTasks(tasks, priority);
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
}
