import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository, IsNull } from 'typeorm';
import {
  Task,
  TaskStatus,
  TaskType,
  MOVE_TYPE,
} from 'src/entities/task.entity';
import { LocationAction, LocationType } from 'src/entities/location.entity';
import { Batch, BatchStatus } from 'src/entities/batch.entity';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { LocationManagerService } from './location_manager.service';
import { OperationType, RobotCount } from 'src/entities/robot-count.entity';
import { ActivityType, TaskActivity } from './dto/task-activity';
import { LoggingService } from '../../services/logging.service';
import { WebhookService } from '../webhook/webhook.service';
import { TASK_CONFIG } from './constants';

@Injectable()
export class TaskService {
  private readonly operationType: OperationType;
  private readonly taskType: TaskType;
  private isProcessing = false;
  constructor(
    readonly LocationManagerService: LocationManagerService,
    private readonly httpService: HttpService,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Batch)
    private readonly batchRepository: Repository<Batch>,
    @InjectRepository(RobotCount)
    private readonly robotRepository: Repository<RobotCount>,
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => WebhookService))
    private readonly webhookService: WebhookService,
  @Optional()
  @Inject(TASK_CONFIG)
  private readonly taskConfig?: { operationType?: OperationType },
  ) {
    // initialize operation / task type for this instance (defaults to BASEOPS)
    this.operationType =
      this.taskConfig?.operationType ?? OperationType.BASEOPS;
    // Derive TaskType from OperationType
    switch (this.operationType) {
      case OperationType.CROSSDOCK:
        this.taskType = TaskType.CROSSDOCK;
        break;
      case OperationType.BASEOPS:
        this.taskType = TaskType.BASEOPS;
        break;
      case OperationType.FLOWOPS:
      default:
        // FLOWOPS maps to GOODS_TO_PERSON tasks by convention in this codebase
        this.taskType = TaskType.GOODS_TO_PERSON;
        break;
    }
    // initialize LocationManagerService for this instance's operation/task type
    try {
      this.LocationManagerService.initForTaskType(this.operationType, this.taskType);
    } catch (err) {
      // If LocationManagerService doesn't implement initForTaskType (older versions), ignore
    }
  }

  async findAllBatches() {
    // Fetch all batches
    let batches = await this.batchRepository.find({
      select: [
        'batch_id',
        'priority',
        'status',
        'total_tasks',
        'completed_tasks',
        'cancelled_tasks',
        'created_at',
        'updated_at',
      ],
      where: { task_type: this.taskType },
      order: { created_at: 'DESC' },
    });

    return batches;
  }

  async findBatchTasks(batch_id: string) {
    let tasks = await this.taskRepository.find({
      where: {
        batch_id: batch_id,
        task_type: this.taskType,
        task_dependency: IsNull(),
      },
      relations: ['batch'],
      order: { created_at: 'DESC' },
    });

    for (const task of tasks) {
      if (task.start_location) {
        task.start_location.display_name =
          await this.LocationManagerService.getDisplayName(
            task.start_location.location_id,
          );
      }

      if (task.end_location) {
        const originalEndLocation =
          await this.LocationManagerService.getLocation(
            task.end_location.location_attribute.attribute_value,
          );

        if (originalEndLocation) {
          task.end_location = {
            ...task.end_location,
            location_id: originalEndLocation.location_id,
            location_type: originalEndLocation.location_type,
            display_name: originalEndLocation.display_name,
          };
        }
      }

      if (
        task.move_type == MOVE_TYPE.ZONE_TO_WAIT &&
        task.status == TaskStatus.COMPLETED
      ) {
        const waitToZoneTask = await this.taskRepository.findOne({
          where: {
            task_dependency: task.task_id,
          },
        });

        if (!waitToZoneTask) {
          task.status = TaskStatus.WAITING;
        } else {
          task.status = waitToZoneTask.status;
        }
      }
    }

    return tasks;
  }

  async findBatchTasksActivities(batch_id: string, task_id: string) {
    // We will gather the ordered list of tasks in the sequence, then
    // 1) create MOVEMENT activities for each
    // 2) insert a WAITING activity after a ZONE_TO_WAIT leg (i.e., when it waits in between)
    const activities: TaskActivity[] = [];
    const orderedTasks: Task[] = [];

    const firstTask = await this.taskRepository.findOne({
      where: { task_id: task_id, batch: { batch_id: batch_id } },
      relations: ['batch'],
    });

    if (!firstTask) {
      return activities; // empty
    }

    orderedTasks.push(firstTask);

    // Follow the dependency chain to collect subsequent tasks
    while (true) {
      const prev = orderedTasks[orderedTasks.length - 1];
      if (!prev) break;
      const nextTask = await this.taskRepository.findOne({
        where: { task_dependency: prev.task_id },
      });
      if (!nextTask) break;
      orderedTasks.push(nextTask);
    }

    // Build activities: MOVEMENT for each task
    for (let i = 0; i < orderedTasks.length; i++) {
      const t = orderedTasks[i];

      // Do not display cancelled tasks
      if (t.status === TaskStatus.CANCELLED) {
        continue;
      }

      if (t.start_location) {
        t.start_location.display_name =
          await this.LocationManagerService.getDisplayName(
            t.start_location.location_id,
          );
      }
      if (t.end_location) {
        t.end_location.display_name =
          await this.LocationManagerService.getDisplayName(
            t.end_location.location_id,
          );
      }

      activities.push({
        activity_id: t.task_id,
        display_activity_id: t.display_task_id,
        activity_type: ActivityType.MOVEMENT,
        status: t.status,
        activity_reason:
          t.status === TaskStatus.HALTED
            ? 'Destination Location is Occupied'
            : undefined,
        move_type: t.move_type,
        robot_id: t.robot_id,
        created_at: t.created_at,
        updated_at: t.updated_at,
        inqueue: t.inqueue ?? null,
        processing: t.processing ?? null,
        completed: t.completed ?? null,
        triggered: t.triggered ?? null,
        cargos: t.cargos,
        start_location: t.start_location,
        end_location: t.end_location,
      });

      // Insert WAITING in between if this leg ends at a wait location
      // i.e., when a ZONE_TO_WAIT target wasn't available and we parked at a wait pallet
      if (t.move_type === MOVE_TYPE.ZONE_TO_WAIT) {
        const waitLocId = t.end_location?.location_id;
        const waitDisplay = waitLocId
          ? await this.LocationManagerService.getDisplayName(waitLocId)
          : undefined;

        // Derive WAIT timestamps (only when previous task is actually COMPLETED)
        const prevCompleted = t.completed ?? null;
        const hasPrevCompleted = !!prevCompleted;
        const nextTask = orderedTasks[i + 1];
        const nextStart = nextTask
          ? (nextTask.processing ?? nextTask.created_at ?? null)
          : null;
        // Determine WAIT status:
        // - If previous task is still PROCESSING -> WAIT is PENDING
        // - Else if next task exists and has progressed beyond PENDING -> WAIT is COMPLETED
        // - Else -> WAITING
        const waitStatus =
          t.status === TaskStatus.PROCESSING
            ? TaskStatus.PENDING
            : nextTask && nextTask.status !== TaskStatus.PENDING
              ? TaskStatus.COMPLETED
              : TaskStatus.WAITING;
        const waitUpdatedAt =
          waitStatus === TaskStatus.COMPLETED
            ? (nextStart ?? prevCompleted)
            : hasPrevCompleted
              ? prevCompleted
              : null;

        // Craft a reason for waiting
        let waitReason: string | undefined = undefined;
        if (nextTask && nextTask.end_location) {
          const nextEndName = await this.LocationManagerService.getDisplayName(
            nextTask.end_location.location_id,
          );
          if (nextTask.end_location.location_type === LocationType.ZONE) {
            waitReason = `Waiting for a location in ${nextEndName} to be available`;
          } else {
            waitReason = `Waiting for location ${nextEndName} to be available`;
          }
        } else if (!nextTask) {
          const attrNameForReason =
            t.end_location?.location_attribute?.attribute_name;
          const attrValueForReason =
            t.end_location?.location_attribute?.attribute_value;
          const derivedEndReasonName =
            attrNameForReason && attrValueForReason
              ? await this.LocationManagerService.getDisplayName(
                  attrValueForReason,
                )
              : undefined;
          if (derivedEndReasonName) {
            if (attrNameForReason === 'ZONE') {
              waitReason = `Waiting for a location in ${derivedEndReasonName} to be available`;
            } else {
              waitReason = `Waiting for location ${derivedEndReasonName} to be available`;
            }
          } else {
            waitReason = undefined;
          }
        }

        activities.push({
          activity_id: `WAIT-${t.task_id}`,
          display_activity_id: `w${t.display_task_id}`,
          activity_type: ActivityType.WAITING,
          status: waitStatus,
          activity_reason: waitReason,
          robot_id: '-',
          created_at: hasPrevCompleted ? prevCompleted : null,
          updated_at: waitUpdatedAt,
          inqueue: null,
          processing: hasPrevCompleted ? prevCompleted : null,
          completed: hasPrevCompleted ? nextStart : null,
          triggered: null,
          start_location: t.end_location
            ? {
                ...t.end_location,
                display_name: waitDisplay ?? t.end_location.display_name,
              }
            : (t.start_location as any),
          end_location: t.end_location
            ? {
                ...t.end_location,
                display_name: waitDisplay ?? t.end_location.display_name,
              }
            : (t.start_location as any),
        } as unknown as TaskActivity);

        // If there is no next non-cancelled task yet, create a synthetic next MOVEMENT (WAIT_TO_ZONE) placeholder
        if (!nextTask) {
          // Derive intended end destination from the attribute on the wait location
          const attrName = t.end_location?.location_attribute?.attribute_name;
          const attrValue = t.end_location?.location_attribute?.attribute_value;
          const derivedEndId = attrValue ?? 'To be decided';
          const derivedEndType =
            attrName === 'ZONE' ? LocationType.ZONE : LocationType.PALLET;
          const derivedEndDisplay = attrValue
            ? await this.LocationManagerService.getDisplayName(attrValue)
            : 'To be decided';

          activities.push({
            activity_id: `NEXT-${t.task_id}`,
            // @ts-ignore: placeholder display id for synthetic activity
            display_activity_id: '-',
            activity_type: ActivityType.MOVEMENT,
            status: TaskStatus.PENDING,
            move_type: MOVE_TYPE.WAIT_TO_ZONE,
            robot_id: '-',
            created_at: null,
            updated_at: null,
            inqueue: null,
            processing: null,
            completed: null,
            triggered: null,
            start_location: t.end_location
              ? {
                  ...t.end_location,
                  display_name: waitDisplay ?? t.end_location.display_name,
                }
              : (t.start_location as any),
            end_location: {
              location_id: derivedEndId as any,
              location_type: derivedEndType,
              location_action: LocationAction.DROP,
              location_dimension: t.end_location?.location_dimension ?? {
                length: 1,
                width: 1,
                height: 1,
              },
              location_attribute: {
                attribute_name: attrName ?? 'ZONE',
                attribute_value: attrValue ?? 'To be decided',
              },
              display_name: derivedEndDisplay as any,
            } as any,
            cargos: t.cargos,
          } as unknown as TaskActivity);
        }
      }
    }

    return activities;
  }

  async findAll() {
    // Return tasks that originate from baseops flows.
    // The CSV importer in this module creates tasks with TaskType.CROSSDOCK
    // and MOVE_TYPE.ZONE_TO_ZONE — treat those as "base ops" tasks.
    let tasks = await this.taskRepository.find({
      where: [{ task_type: this.taskType }],
      relations: ['batch'],
      order: { created_at: 'DESC' },
    });

    for (const task of tasks) {
      if (task.start_location) {
        task.start_location.display_name =
          await this.LocationManagerService.getDisplayName(
            task.start_location.location_id,
          );
      }

      if (task.end_location) {
        task.end_location.display_name =
          await this.LocationManagerService.getDisplayName(
            task.end_location.location_id,
          );
      }

      console.log(
        `Task ${task.task_id} start location: ${JSON.stringify(task.start_location)}, end location: ${JSON.stringify(task.end_location)}`,
      );
    }

    return tasks;
  }

  async shouldCreateTask(): Promise<boolean> {
    const robotAvailable = await this.isRobotAvailable();
    if (!robotAvailable) {
      console.log(
        `No robots available to process ${String(this.taskType)} tasks at the moment.`,
      );
      return false;
    }
    const isWaiting = await this.checkIfSystemIsInWaitingState();
    if (isWaiting) {
      console.log(
        `System is in waiting state, not dispatching new ${String(this.taskType)} tasks.`,
      );
      return false;
    }
    return true;
  }

  public async orchestrator(): Promise<void> {
    // Prevent overlapping executions
    if (this.isProcessing) {
      console.log('Previous cron job still running, skipping this execution');
      return;
    }
    console.log(`--- start ${String(this.taskType)} cron job ---`);
    try {
      if (!(await this.shouldCreateTask())) {
        return;
      }
      await this.processWaitHaultedTasks();
      if (!(await this.shouldCreateTask())) {
        return;
      }
      await this.processNextTask();
      this.isProcessing = false;
    } catch (error) {
      console.error('Error in cron job processNextTask:', error);
    }
  }

  async findNextTask(): Promise<Task | null> {
    const nextTask = await this.taskRepository.findOne({
      where: {
        task_type: this.taskType,
        status: TaskStatus.PENDING,
        move_type: MOVE_TYPE.ZONE_TO_ZONE,
      },
      relations: ['batch'],
      order: {
        batch: { priority: 'ASC', created_at: 'ASC' },
        priority: 'ASC',
        created_at: 'ASC',
      },
    });
    return nextTask;
  }

  async processWaitHaultedTasks(): Promise<void> {
    // Process wait tasks
    const waitTasks = await this.taskRepository.find({
      where: {
        task_type: this.taskType,
        status: TaskStatus.COMPLETED,
        move_type: MOVE_TYPE.ZONE_TO_WAIT,
      },
      relations: ['batch'],
      order: {
        batch: { priority: 'ASC', created_at: 'ASC' },
        priority: 'ASC',
        created_at: 'ASC',
      },
    });

    for (const task of waitTasks) {
      if (!task.end_location) {
        continue;
      }

      const sequenceTask = await this.taskRepository.findOne({
        where: { task_dependency: task.task_id },
      });
      if (sequenceTask) {
        continue;
      } // already has a next sequence task

      let end_location_id: string | null = null;
      if (task.end_location.location_attribute?.attribute_name === 'ZONE') {
        end_location_id =
          await this.LocationManagerService.findOptimalDropLocation(
            task.end_location.location_attribute?.attribute_value,
          );
        if (!end_location_id) {
          continue;
        }
      } else {
        end_location_id = task.end_location.location_attribute.attribute_value;
      }

      if (
        !(await this.LocationManagerService.reserveLocation(end_location_id))
      ) {
        continue;
      }

      const newTask = await this.createNextSequenceTask(task, end_location_id);
      if (!newTask) continue;

      // Send to WMS and increment - extracted to helper method
      const success = await this.sendTaskToWMSAndIncrement(
        newTask,
        end_location_id,
        task.batch.priority,
      );
      if (success) {
        await this.taskRepository.update(
          { task_id: newTask.task_id },
          { status: TaskStatus.ASSIGNED },
        );
      }
    }

    // Process HALTED tasks
    const haultedTasks = await this.taskRepository.find({
      where: {
        task_type: this.taskType,
        status: TaskStatus.HALTED,
        move_type: MOVE_TYPE.ZONE_TO_ZONE,
      },
      relations: ['batch'],
      order: {
        batch: { priority: 'ASC', created_at: 'ASC' },
        priority: 'ASC',
        created_at: 'ASC',
      },
    });

    for (const task of haultedTasks) {
      if (!task.end_location) {
        continue;
      }
      await this.processTask(task);
    }
  }

  // Helper method to avoid duplication
  private async sendTaskToWMSAndIncrement(
    task: Task,
    end_location_id: string,
    batchPriority: number,
  ): Promise<boolean> {
    const req_tasks = [
      {
        task_id: task.task_id,
        task_type: String(this.taskType),
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
        cargos: task.cargos,
      },
    ];

    const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
    const warehouse_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
    const wms_base_url =
      process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';

    const req_body = {
      batch_type: 'DISCRETE',
      batch_priority: batchPriority,
      tasks: req_tasks,
    };

    try {
      await firstValueFrom(
        this.httpService.post(
          `${wms_base_url}/robot-job/${warehouse_name}/tasks`,
          req_body,
          {
            headers: {
              authorization: `${warehouse_key}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      // Log dispatch success
      await this.loggingService.log(
        `Task ${task.task_id} sent to WMS API layer`,
        this.taskType,
        task.task_id,
        task.batch_id ?? null,
      );

      await this.incrementRobotInUse(); // ← Single increment point
      await this.loggingService.log(
        `Robot in use incremented. Current robot in use: ${await this.getRobotInUse()}`,
        this.taskType,
        task.task_id,
        task.batch_id ?? null,
      );
      return true;
    } catch (error) {
      console.error(`Error sending task ${task.task_id} to WMS Layer:`, error);
      await this.loggingService.createErrorLog(
        `Error sending task ${task.task_id} to WMS Layer: ${error?.message ?? error}`,
        this.taskType,
        task.task_id,
        task.batch_id ?? null,
        true,
      );
      await this.loggingService.log(
        `Task ${task.task_id} failed to send to WMS. Releasing location ${end_location_id}`,
        this.taskType,
        task.task_id,
        task.batch_id ?? null,
      );
      await this.LocationManagerService.freeLocation(end_location_id);
      await this.taskRepository.delete({ task_id: task.task_id });
      return false;
    }
  }

  async processNextTask(): Promise<string | null> {
    // ---> find next to process, task_type=BaseOps, status=PENDING, move_type=ZONE_TO_ZONE, its batch should have lowest priority
    const nextTask = await this.findNextTask();

    if (!nextTask) {
      console.log(`No pending ${String(this.taskType)} tasks found.`);
      return null;
    }

    try {
      // Your batch processing logic here
      await this.processTask(nextTask);
      return nextTask.task_id;
    } catch (error) {
      console.error(
        `Error sending batch ${nextTask.batch.batch_id} to WMS Layer:`,
        error,
      );
      throw error;
    }
  }

  private async processTask(task: Task): Promise<void> {
    // Implement your actual task processing logic here
    console.log(`Processing task: ${task.task_id}`);
    if (!task) return;
    const req_tasks: any[] = [];
    let end_location_id: string | null = null;
    if (task.end_location.location_attribute?.attribute_name === 'ZONE') {
      // write the logic to find the pallet location in that zone
      end_location_id =
        await this.LocationManagerService.findOptimalDropLocation(
          task.end_location.location_attribute?.attribute_value,
        );
      if (!end_location_id) {
        // no optimal drop location found in the zone, look for the location in wait zone
        end_location_id =
          await this.LocationManagerService.getOptimalWaitLocation(
            task.end_location.location_attribute?.attribute_value,
          );
        if (!end_location_id) {
          // no wait location was found instead
          console.log(
            `No wait location found, re-queue the task ${task.task_id}`,
          );
          // mark the current task status as Haulted
          await this.markTaskHaulted(task.task_id);
          return;
        }
        task.end_location.location_id = end_location_id;
        await this.taskRepository.update(
          { task_id: task.task_id },
          {
            end_location: task.end_location,
            move_type: MOVE_TYPE.ZONE_TO_WAIT,
          },
        );
        await this.loggingService.log(
          `Task ${task.task_id} rerouted to WAIT location ${end_location_id} (zone unavailable)`,
          this.taskType,
          task.task_id,
          task.batch_id ?? null,
        );
      }
      task.end_location.location_id = end_location_id;
      await this.taskRepository.update(
        { task_id: task.task_id },
        { end_location: task.end_location },
      );
    } else {
      end_location_id = task.end_location.location_id;
    }

    const reserveStartLocation =
      await this.LocationManagerService.reserveStartLocation(
        task.start_location.location_id,
      );
    if (!reserveStartLocation) {
      console.log(
        `Location ${task.start_location.location_id} is not available.`,
      );
      await this.markTaskHaulted(task.task_id);
      await this.loggingService.log(
        `Task ${task.task_id} marked HALTED: start location ${task.start_location.location_id} unavailable`,
        this.taskType,
        task.task_id,
        task.batch_id ?? null,
      );
      return;
    }

    const reserveEndLocation =
      await this.LocationManagerService.reserveLocation(end_location_id);
    if (!reserveEndLocation) {
      console.log(`Location ${end_location_id} is not available.`);
      if (task.end_location.location_attribute?.attribute_name === 'ZONE') {
        await this.LocationManagerService.freeLocation(
          task.start_location.location_id,
        );
        return;
      }
      end_location_id =
        await this.LocationManagerService.getOptimalWaitLocation(
          task.end_location.location_attribute?.attribute_value,
        );
      if (!end_location_id) {
        console.log(
          `No wait location found, re-queue the task ${task.task_id}`,
        );
        await this.markTaskHaulted(task.task_id);
        await this.LocationManagerService.freeLocation(
          task.start_location.location_id,
        );
        await this.loggingService.log(
          `Task ${task.task_id} marked HALTED: no wait location available for ${task.end_location.location_attribute?.attribute_value}`,
          task.task_type,
          task.task_id,
          task.batch_id ?? null,
        );
        return;
      }
      if (
        !(await this.LocationManagerService.reserveLocation(end_location_id))
      ) {
        return;
      }
      task.end_location.location_id = end_location_id;
      await this.taskRepository.update(
        { task_id: task.task_id },
        { end_location: task.end_location, move_type: MOVE_TYPE.ZONE_TO_WAIT },
      );
      await this.loggingService.log(
        `Task ${task.task_id} rerouted to WAIT location ${end_location_id} (destination occupied)`,
        this.taskType,
        task.task_id,
        task.batch_id ?? null,
      );
    }
    req_tasks.push({
      task_id: task.task_id,
      task_type: String(this.taskType),
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
      cargos: task.cargos,
    });
    const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
    const warehouse_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
    const wms_base_url =
      process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';
    const req_body = {
      batch_type: 'DISCRETE',
      batch_priority: task.batch.priority,
      tasks: req_tasks,
    };
    try {
      await firstValueFrom(
        this.httpService.post(
          `${wms_base_url}/robot-job/${warehouse_name}/tasks`,
          req_body,
          {
            headers: {
              authorization: `${warehouse_key}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
    } catch (error) {
      console.error(
        `Error sending batch ${task.batch.batch_id} to WMS Layer:`,
        error,
      );
      await this.LocationManagerService.freeLocation(end_location_id);
      await this.loggingService.createErrorLog(
        `Error sending task ${task.task_id} to WMS Layer: ${error?.message ?? error}`,
        this.taskType,
        task.task_id,
        task.batch_id ?? null,
        true,
      );
      return;
    }
    await this.loggingService.log(
      `Task ${task.task_id} sent to WMS API layer`,
      this.taskType,
      task.task_id,
      task.batch_id ?? null,
    );
    await this.incrementRobotInUse();
    await this.loggingService.log(
      `Robot in use incremented. Current robot in use: ${await this.getRobotInUse()}`,
      this.taskType,
      task.task_id,
      task.batch_id ?? null,
    );
    await this.taskRepository.update(
      { task_id: task.task_id },
      { status: TaskStatus.ASSIGNED },
    );
  }

  private async markTaskHaulted(task_id: string): Promise<void> {
    await this.taskRepository.update(
      { task_id: task_id },
      { status: TaskStatus.HALTED },
    );
    await this.loggingService.log(
      `Task ${task_id} marked as HALTED`,
      this.taskType,
      task_id,
      null,
    );
  }

  async parseCsv(csvData: string): Promise<any[]> {
    const lines = csvData.split('\n').filter((line) => line.trim() !== '');
    const headers = lines[0].split(',').map((header) => header.trim());

    // Process each line of the CSV
    const tasks = lines.slice(1).map((line, index) => {
      const values = line.split(',').map((value) => value.trim());
      const task: any = {};
      headers.forEach((header, headerIndex) => {
        task[header] = values[headerIndex] || '';
      });
      task._rowNumber = index + 2; // For error reporting (accounting for header row)
      return task;
    });
    return tasks;
  }

  async generateBatchId(): Promise<string> {
    // Get current date
    const now = new Date();

    // Format date as dd-mm-yyyy
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0'); // getMonth() returns 0-11
    const year = now.getFullYear();
    const dateString = `${day}${month}${year}`;

    // Get start and end of today for database query
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
    );
    const endOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
    );

    // Count batches created today
    const todayBatchCount = await this.batchRepository.count({
      where: {
        created_at: Between(startOfDay, endOfDay),
        task_type: this.taskType,
      },
    });

    // Generate batch ID with incremented count
    const batchNumber = todayBatchCount + 1;
    const batchId = `${dateString}_${batchNumber}`;

    return batchId;
  }
  async processTasks(tasks: any[], priority: number): Promise<any> {
    
    // Generate a batch
    const batch_id = await this.generateBatchId();
    const batch = this.batchRepository.create({
      batch_id: batch_id,
      task_type: this.taskType,
      description: `${String(this.taskType)} Batch`,
      status: BatchStatus.PENDING,
      total_tasks: 0, // Will be updated as tasks are created
      completed_tasks: 0,
    });
    await this.batchRepository.save(batch);
    if (!batch) {
      throw new Error('Failed to create or retrieve the batch');
    }
    batch.priority = priority;
    await this.batchRepository.save(batch);

    for (const task of tasks) {
      const newTask = new Task();
      newTask.batch_id = batch.batch_id;
      newTask.task_type = this.taskType;
      newTask.status = TaskStatus.PENDING;
      newTask.move_type = MOVE_TYPE.ZONE_TO_ZONE;
      newTask.sequence_order = 1;
      newTask.task_dependency = null as any;
      newTask.robot_id = null as any;
      newTask.priority = task['priority'];

      let end_location_id = null;
      if (task['end_location_location_type'] === 'PALLET') {
        end_location_id = task['end_location_location_id'];
      }

      newTask.start_location = {
        location_id: task['start_location_location_id'],
        location_type: LocationType.PALLET, // Fixed since we validate it's always PALLET
        location_action: LocationAction.PICK,
        location_dimension: {
          length: 1,
          width: 1,
          height: 1,
        },
        location_attribute: {
          attribute_name: 'Pallet',
          attribute_value: task['start_location_location_id'],
        },
      };

      newTask.end_location = {
        location_id:
          end_location_id !== null ? end_location_id : 'To be decided',
        location_type: LocationType.PALLET,
        location_action: LocationAction.DROP,
        location_dimension: {
          length: 1,
          width: 1,
          height: 1,
        },
        location_attribute: {
          attribute_name: end_location_id === null ? 'ZONE' : 'Pallet',
          attribute_value: task['end_location_location_id'],
        },
      };

      newTask.wait = null as any;
      if (task['barcode_number']) {
        newTask.cargos = [
          {
            cargo_code: task['barcode_number'],
            cargo_type: 'Pallet',
            cargo_dimension: {
              length: 1,
              width: 1,
              height: 1,
            },
            cargo_attributes: null,
            cargo_weight: 1,
          },
        ];
      } else {
        newTask.cargos = null as any;
      }

      await this.taskRepository.save(newTask);
      await this.loggingService.log(
        `New Task: ${newTask.task_id}, start location: ${newTask.start_location.location_id} (pallet), destination location: ${newTask.end_location.location_id} (${newTask.end_location.location_attribute.attribute_name === 'ZONE' ? 'zone' : 'pallet'})`,
        this.taskType,
        newTask.task_id,
        batch.batch_id,
      );

      batch.total_tasks += 1;
      await this.batchRepository.save(batch);
    }

    return tasks;
  }

  async isRobotAvailable(): Promise<boolean> {
    const robots = await this.robotRepository.find({
      where: { operation_type: this.operationType },
    });
    if (robots.length === 0) {
      return false;
    }
    const robot = robots[0];
    return robot.total_robots - robot.robot_in_use > 0;
  }
  async incrementRobotInUse(): Promise<void> {
    console.log('increment robot in use count');
    const queryRunner =
      this.robotRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Atomic increment - no race condition possible
      const result = await queryRunner.manager
        .createQueryBuilder()
        .update(RobotCount)
        .set({
          robot_in_use: () => 'robot_in_use + 1',
        })
        .where('operation_type = :operation_type', {
          operation_type: this.operationType,
        })
        .execute();

      if (result.affected === 0) {
        throw new Error('No Robot Entry Found');
      }
      console.log(`Robot in use incremented successfully.`);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async decrementRobotInUse(): Promise<void> {
    const queryRunner =
      this.robotRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Atomic decrement with safety check to prevent negative values
      const result = await queryRunner.manager
        .createQueryBuilder()
        .update(RobotCount)
        .set({
          robot_in_use: () => 'GREATEST(robot_in_use - 1, 0)',
        })
        .where('operation_type = :opType', { opType: this.operationType })
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

  async getRobotInUse(): Promise<number> {
    const robots = await this.robotRepository.find({
      where: { operation_type: this.operationType },
    });
    if (robots.length === 0) return 0;
    return robots[0].robot_in_use;
  }

  async checkIfSystemIsInWaitingState(): Promise<boolean> {
    const robots = await this.robotRepository.find({
      where: { operation_type: this.operationType },
    });
    if (robots.length === 0) {
      return false;
    }
    const isWaiting = robots[0].is_waiting;
    return isWaiting;
  }

  async markSystemAsWaiting(): Promise<void> {
    const queryRunner =
      this.robotRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const robots = await queryRunner.manager.find(RobotCount);
      if (robots.length === 0) {
        throw new Error('No Robot Entry Found');
      }
      await queryRunner.manager.update(
        RobotCount,
        { id: robots[0].id, operation_type: this.operationType },
        { is_waiting: true },
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
    const queryRunner =
      this.robotRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const robots = await queryRunner.manager.find(RobotCount);
      if (robots.length === 0) {
        throw new Error('No Robot Entry Found');
      }
      await queryRunner.manager.update(
        RobotCount,
        { id: robots[0].id, operation_type: this.operationType },
        { is_waiting: false },
      );
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async setInitialConfiguration(): Promise<void> {
    const robots = await this.robotRepository.find({
      where: { operation_type: this.operationType },
    });
    console.log(
      `Current ${String(this.taskType)} robot configurations: ${robots.length}`,
    );
    if (robots.length === 0) {
      const newRobotConfig = new RobotCount();
      newRobotConfig.operation_type = this.operationType;
      newRobotConfig.total_robots = 1;
      newRobotConfig.robot_in_use = 0;
      newRobotConfig.is_waiting = false;
      await this.robotRepository.save(newRobotConfig);
    }

    // await this.LocationManagerService.syncFMSLocations();
  }

  async getManualTaskStartLocation() {
    return await this.LocationManagerService.getManualTaskStartLocation();
  }

  async getManualTaskEndLocation() {
    return await this.LocationManagerService.getManualTaskEndLocation();
  }

  async createNextSequenceTask(
    task: Task,
    end_location_id: string,
  ): Promise<Task | null> {
    const newTask = new Task();
    newTask.batch_id = task.batch.batch_id;
    newTask.task_type = this.taskType;
    newTask.status = TaskStatus.PENDING;
    newTask.move_type = MOVE_TYPE.WAIT_TO_ZONE;
    newTask.sequence_order = task.sequence_order + 1;
    newTask.task_dependency = task.task_id;
    newTask.robot_id = null as any;
    newTask.priority = task.priority;

    newTask.start_location = {
      location_id: task.end_location.location_id,
      location_type: LocationType.PALLET,
      location_action: LocationAction.PICK,
      location_dimension: {
        length: 1,
        width: 1,
        height: 1,
      },
      location_attribute: {
        attribute_name: task.end_location.location_attribute.attribute_name,
        attribute_value: task.end_location.location_attribute.attribute_value,
      },
    };

    newTask.end_location = {
      location_id: end_location_id !== null ? end_location_id : 'To be decided',
      location_type:
        task.end_location.location_type === 'PALLET'
          ? LocationType.PALLET
          : LocationType.ZONE,
      location_action: LocationAction.DROP,
      location_dimension: {
        length: 1,
        width: 1,
        height: 1,
      },
      location_attribute: {
        attribute_name: task.end_location.location_attribute.attribute_name,
        attribute_value: task.end_location.location_attribute.attribute_value,
      },
    };

    newTask.wait = null as any;
    if (task.cargos && task.cargos.length > 0) {
      newTask.cargos = [
        {
          cargo_code: task.cargos[0].cargo_code,
          cargo_type: 'Pallet',
          cargo_dimension: {
            length: 1,
            width: 1,
            height: 1,
          },
          cargo_attributes: null,
          cargo_weight: 1,
        },
      ];
    } else {
      newTask.cargos = null as any;
    }

    return await this.taskRepository.save(newTask);
  }

  async cancelTask(task_id: string): Promise<any> {
    const task = await this.taskRepository.findOne({ where: { task_id } });
    if (!task) {
      throw new BadRequestException(`Task ${task_id} not found`);
    }

    // Only allow cancelling if task is PENDING or HALTED
    if (
      !(task.status === TaskStatus.PENDING || task.status === TaskStatus.HALTED)
    ) {
      throw new BadRequestException(
        `Task ${task_id} must be in PENDING or HALTED state to cancel (current: ${task.status})`,
      );
    }

    if (task.fms_batch_id) {
      throw new BadRequestException(
        `Task ${task_id} has already been sent for execution.`,
      );
    }

    // Mark cancelled in DB
    await this.taskRepository.update(
      { task_id: task.task_id },
      { status: TaskStatus.CANCELLED },
    );
    await this.loggingService.log(
      `Task ${task.task_id} marked as CANCELLED`,
      this.taskType,
      task.task_id,
      task.batch_id ?? null,
    );

    // Only notify BaseOps webhook if this service instance is configured for BaseOps

    await this.webhookService.updateBatchStatus(task.batch_id, this.taskType);

    return { task_id: task.task_id, status: TaskStatus.CANCELLED };
  }
}
