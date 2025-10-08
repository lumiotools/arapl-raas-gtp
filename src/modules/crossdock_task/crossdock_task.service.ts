import { BadRequestException, Inject, Injectable, forwardRef } from '@nestjs/common';
import { TaskService } from '../tasks/tasks.service';

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

      const priorityValue = task['priority'];
      if (priorityValue !== 'HIGH' && priorityValue !== 'MEDIUM' && priorityValue !== 'LOW') {
        validationErrors.push(`Row ${rowNum-1}: priority must be 'HIGH', 'MEDIUM', or 'LOW', found '${priorityValue}'`);
      }

      task['priority'] = task['priority'] === 'HIGH' ? 1 : task['priority'] === 'MEDIUM' ? 2 : 3;

      // 7. Check if the start and end location ids exist in the system and they are available
      const startLocationValid = await this.taskService.LocationManagerService.isValidLocationId(startLocationId, true);
      if (!startLocationValid) {
        validationErrors.push(`Row ${rowNum-1}: start_location_location_id '${startLocationId}' is not available or does not exist in the system`);
      }
      const OtherTaskWithStartLocation = await this.taskService.LocationManagerService.otherTaskWithStartLocation(startLocationId);
      if (OtherTaskWithStartLocation){
        validationErrors.push(`Row ${rowNum-1}: start_location_location_id '${startLocationId}' is already assigned to another pending task (${OtherTaskWithStartLocation})`);
      }

    }
    console.log(`Validation completed with ${validationErrors.length} errors.`);
    // If there are validation errors, throw them
    if (validationErrors.length > 0) {
      throw new BadRequestException(`Data Validation Failed:\n${validationErrors.join('\n')}`);
    }

    // Remove the temporary row number field before processing
    tasks.forEach(task => delete task._rowNumber);

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
