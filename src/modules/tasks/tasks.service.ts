import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Optional,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository, IsNull, MoreThan, In, Not } from 'typeorm';
import {
  Task,
  TaskStatus,
  TaskType,
  MOVE_TYPE,
} from 'src/entities/task.entity';
import { LocationAction, LocationEntity, LocationType } from 'src/entities/location.entity';
import { Batch, BatchStatus } from 'src/entities/batch.entity';
import { HttpService } from '@nestjs/axios';
import { LocationManagerService } from './location_manager.service';
import { OperationType, RobotCount } from 'src/entities/robot-count.entity';
import { ActivityType, TaskActivity } from './dto/task-activity';
import { LoggingService } from '../../services/logging.service';
import { WebhookService } from '../webhook/webhook.service';
import { TASK_CONFIG } from './constants';
import { LocationStatus } from 'src/entities/station.entity';

@Injectable()
export class TaskService implements OnModuleInit {
  private readonly operationType: OperationType;
  private readonly taskType: TaskType;
  private isProcessing = false;
  constructor(
    readonly LocationManagerService: LocationManagerService,
    private readonly httpService: HttpService,
    @InjectRepository(Task)
    readonly taskRepository: Repository<Task>,
    @InjectRepository(Batch)
    readonly batchRepository: Repository<Batch>,
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

  async onModuleInit(): Promise<void> {
    // Ensure initial setup and FMS locations sync happen on module initialization
    try {
      await this.LocationManagerService.syncFMSLocations();
    } catch (err) {
      console.error('Error during TaskService module initialization:', err);
    }
  }

  async findAllBatches() {
    // Fetch all batches
    let batches = await this.batchRepository.find({
      select: [
        'batch_id',
        'wms_batch_id',
        'task_type',
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
    // Enrich with alert (HALTED reason) if batch itself is HALTED
    for (const batch of batches) {
      if ((batch as any).status === TaskStatus.HALTED) {
        const haltedTask = await this.taskRepository.findOne({
          where: { batch_id: (batch as any).batch_id, status: TaskStatus.HALTED },
          order: { updated_at: 'DESC', created_at: 'DESC' },
        });
        if (haltedTask) {
          (batch as any).alert = await this.computeHaltReason(haltedTask);
        } else {
          (batch as any).alert = undefined;
        }
      } else {
        (batch as any).alert = undefined;
      }
    }
    return batches;
  }

  async findBatchById(batch_id: string) {
    const batch = await this.batchRepository.findOne({
      where: { batch_id: batch_id, task_type: this.taskType },
    });
    return batch;
  }

  async findBatchTasks(batch_id: string) {
    const tasks = await this.taskRepository.find({
      where: {
        batch_id: batch_id,
        task_type: this.taskType,
        task_dependency: IsNull(),
      },
      relations: ['batch'],
      order: { created_at: 'DESC' },
    });

    for (const task of tasks) {
      // For CROSSDOCK, render the task as originally received by user (pallet→zone or pallet→pallet)
      // even if we split it internally into PICK_ENTRY / ZONE_TO_DROP_ENTRY / DROP_ENTRY_TO_ZONE.
      if (this.taskType === TaskType.CROSSDOCK) {
        try {
          // Walk the chain to find the main leg and final leg
          const chain: Task[] = [];
          let cur: Task | null = task;
          // Include the current task and all dependents
          while (cur) {
            chain.push(cur);
            const nxt = await this.taskRepository.findOne({ where: { task_dependency: cur.task_id } });
            cur = nxt ?? null;
          }

          // Main leg: ZONE_TO_DROP_ENTRY if present, else ZONE_TO_ZONE
          const mainLeg = chain.find((t) => t.move_type === MOVE_TYPE.ZONE_TO_DROP_ENTRY)
            ?? chain.find((t) => t.move_type === MOVE_TYPE.ZONE_TO_ZONE)
            ?? task;

          // Final leg: DROP_ENTRY_TO_ZONE if present
          const finalLeg = chain.find((t) => t.move_type === MOVE_TYPE.DROP_ENTRY_TO_ZONE) ?? null;

          // Render as originally requested by the user
          const renderStart = mainLeg.start_location ?? task.start_location;
          const renderEnd = finalLeg?.end_location ?? mainLeg.end_location ?? task.end_location;

          // Do not persist; only shape the response object
          task.start_location = renderStart as any;
          task.end_location = renderEnd as any;
          const validFirstChainNode = chain.find((t)=> [MOVE_TYPE.PICK_ENTRY, MOVE_TYPE.ZONE_TO_ZONE].includes(t.move_type) &&  t.status !== TaskStatus.CANCELLED);
          (task as any).start_time = validFirstChainNode?.processing ?? validFirstChainNode?.inqueue;
          (task as any).end_time = chain[chain.length - 1]?.[chain[chain.length - 1]?.status === TaskStatus.CANCELLED ? 'updated_at' : 'completed'] ?? null;
        } catch (e) {
          // Fallback: keep task as-is on any error
        }
      } else {
        (task as any).start_time = task.processing ?? task.inqueue;
        (task as any).end_time = (task.status === TaskStatus.CANCELLED ? task.updated_at : task.completed) ?? null;
      }

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

        if(task.status === TaskStatus.COMPLETED){
          const finalEndLocation = await this.LocationManagerService.getLocation(
            task.end_location.location_id,
          );
          if (finalEndLocation) {
            (task as any).final_end_location = {
              ...task.end_location,
              location_id: finalEndLocation.location_id,
              location_type: finalEndLocation.location_type,
              display_name: finalEndLocation.display_name,
            };
          }
        }

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

        // Aggregate status and timestamps for Crossdock chains
        if (this.taskType === TaskType.CROSSDOCK) {
          try {
            // 1) Aggregate chain status (already computed elsewhere if needed)
            const chainStatuses = await this.collectChainStatuses(batch_id, task.task_id);
            const aggregate = this.aggregateStatuses(chainStatuses);
            task.status = aggregate;
          } catch {}
        } else {
          // For non-crossdock, expose start/end based on the task itself
          const startCandidate = task.inqueue ?? task.processing ?? task.created_at ?? null;
          const endCandidate = task.completed ?? null;
          (task as any).start_time = startCandidate;
          (task as any).end_time = endCandidate;
        }
        if (!waitToZoneTask) {
          task.status = TaskStatus.WAITING;
        } else {
          task.status = waitToZoneTask.status;
        }
      }

      // Aggregate status across the full chain for Crossdock
      if (this.taskType === TaskType.CROSSDOCK) {
        try {
          const chainStatuses = await this.collectChainStatuses(batch_id, task.task_id);
          const aggregate = this.aggregateStatuses(chainStatuses);
          task.status = aggregate;
          // Recompute alert if now HALTED
        } catch (e) {
          // On failure keep task.status as-is
        }
      }

      // Attach HALTED reason for UI/API consumers (renamed to alert)
      (task as any).alert = await this.computeHaltReason(task)
    }

    return tasks;
  }

  // Helper: collect statuses for a full dependency chain (BFS fan-out) starting from root
  private async collectChainStatuses(batch_id: string, rootTaskId: string): Promise<TaskStatus[]> {
    const statuses: TaskStatus[] = [];
    const visited = new Set<string>();
    let frontier: string[] = [rootTaskId];
    while (frontier.length > 0) {
      const nodes = await this.taskRepository.find({
        where: [
          { task_id: In(frontier), batch: { batch_id } },
          { task_dependency: In(frontier), batch: { batch_id } },
        ],
      });
      const nextFrontier: string[] = [];
      for (const n of nodes) {
        if (!visited.has(n.task_id) && n.move_type !== MOVE_TYPE.PICK_ENTRY) {
          visited.add(n.task_id);
          statuses.push(n.status);
          if (n.task_dependency && frontier.includes(n.task_dependency) === false) {
            // no-op; we already expand by dependency on frontier via where clause
          }
          nextFrontier.push(n.task_id);
        }
      }
      // Discover dependents of all nodes we just saw in this level
      const dependents = await this.taskRepository.find({
        where: { task_dependency: In(nextFrontier), batch: { batch_id } },
        select: ['task_id', 'status'],
      });
      for (const d of dependents) {
        if (!visited.has(d.task_id)) {
          // We won't push status yet; it will be captured in the next loop iteration
          nextFrontier.push(d.task_id);
        }
      }
      frontier = Array.from(new Set(nextFrontier));
      // Stop condition guard to avoid infinite loops
      if (frontier.length === 0) break;
      // Trim frontier to only those not yet visited
      frontier = frontier.filter((id) => !visited.has(id));
    }
    // Ensure root included even if not fetched above
    if (!visited.has(rootTaskId)) {
      const root = await this.taskRepository.findOne({ where: { task_id: rootTaskId, batch: { batch_id }, move_type: Not(MOVE_TYPE.PICK_ENTRY) } });
      if (root) statuses.push(root.status);
    }
    return statuses;
  }

  // Helper: aggregate statuses per provided mapping/priorities
  private aggregateStatuses(statuses: TaskStatus[]): TaskStatus {
    if (!statuses || statuses.length === 0) return TaskStatus.PENDING;
    const unique = new Set(statuses);
    // All cancelled -> CANCELLED
    if (unique.size === 1 && unique.has(TaskStatus.CANCELLED)) {
      return TaskStatus.CANCELLED;
    }
    // Any PROCESSING -> PROCESSING
    if (unique.has(TaskStatus.PROCESSING)) return TaskStatus.PROCESSING;
    // Any ASSIGNED or INQUEUE -> ASSIGNED
    if (unique.has(TaskStatus.ASSIGNED) || unique.has((TaskStatus as any).INQUEUE)) return TaskStatus.ASSIGNED;
    // Any HALTED -> HALTED
    if (unique.has((TaskStatus as any).HALTED)) return TaskStatus.HALTED;
    // Any WAITING -> WAITING
    if (unique.has((TaskStatus as any).WAITING)) return TaskStatus.WAITING;
    // Any PENDING -> PENDING
    if (unique.has((TaskStatus as any).PENDING)) return TaskStatus.PENDING;
    // Any PENDING / HALTED / WAITING -> PENDING
    // if (unique.has(TaskStatus.PENDING) || unique.has((TaskStatus as any).HALTED) || unique.has((TaskStatus as any).WAITING)) {
    //   // If all are pending -> pending; else mixture with completed/cancelled still shows pending based on given examples leaning towards higher progress; but
    //   // user wants assigned > pending; since we passed assigned above, we return pending here
    //   // Edge: if only completed+cancelled would be handled below
    //   return TaskStatus.PENDING;
    // }
    // Completed mixed with Cancelled -> COMPLETED
    if (unique.has(TaskStatus.COMPLETED)) return TaskStatus.COMPLETED;
    // Fallback: if we reach here and we have statuses but none matched, prefer first
    return statuses[0];
  }

  // Helper: provide a human-readable reason for HALTED tasks, consistent across views
  private async computeHaltReason(t: Task): Promise<string | undefined> {
    if (t.status !== TaskStatus.HALTED) return undefined;
    if (t.end_location?.location_attribute?.attribute_name === 'ZONE') {
      const zoneId = t.end_location.location_attribute.attribute_value;
      const zoneName = zoneId
        ? await this.LocationManagerService.getDisplayName(zoneId)
        : undefined;
      return zoneName
        ? `No directly accessible locations in ${zoneName}`
        : 'No directly accessible locations in target zone';
    } else {
      return `Location ${t.end_location.display_name} is not directly accessible`;
    }
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

    // Follow the dependency graph to collect ALL subsequent tasks (fan-out supported)
    const visited = new Set<string>([firstTask.task_id]);
    let frontier: string[] = [firstTask.task_id];
    while (frontier.length > 0) {
      const dependents = await this.taskRepository.find({
        where: { task_dependency: In(frontier), batch: { batch_id } },
        relations: ['batch'],
      });
      const newlyDiscovered: Task[] = [];
      for (const dep of dependents) {
        if (!visited.has(dep.task_id)) {
          visited.add(dep.task_id);
          newlyDiscovered.push(dep);
        }
      }
      orderedTasks.push(...newlyDiscovered);
      frontier = newlyDiscovered.map((t) => t.task_id);
    }

    // Order tasks by their sequence within the chain
    orderedTasks.sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0));

    // Build activities: MOVEMENT for each task
    for (let i = 0; i < orderedTasks.length; i++) {
      const t = orderedTasks[i];

      // Include cancelled tasks as well to present complete sequence (A, B, C, D...)

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

      const stime = t.processing || (t.status === TaskStatus.CANCELLED ? t.updated_at : null);
      const etime = t.status === TaskStatus.CANCELLED ? t.updated_at : t.completed;

      let activityReason: string | undefined;
      if (t.status === TaskStatus.HALTED) {
        if (t.end_location?.location_attribute?.attribute_name === 'ZONE') {
          const zoneId = t.end_location.location_attribute.attribute_value;
          const zoneName = zoneId
        ? await this.LocationManagerService.getDisplayName(zoneId)
        : undefined;
          activityReason = zoneName
        ? `No directly accessible locations in ${zoneName}`
        : 'No directly accessible locations in target zone';
        } else {
          activityReason = `Location ${t.end_location.display_name} is not directly accessible`;
        }
      } else {
        activityReason = undefined;
      }

      activities.push({
        activity_id: t.task_id,
        display_activity_id: t.display_task_id,
        activity_type: ActivityType.MOVEMENT,
        status: t.status,
        activity_reason: activityReason,
        move_type: t.move_type,
        robot_id: t.robot_id,
        start_time: stime,
        end_time: etime,
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
        batch: { priority: 'ASC' },
        priority: 'ASC'
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
            task.end_location.location_attribute?.attribute_zone_pair_id,
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

      newTask.end_location.location_id = end_location_id;

      // Send to WMS and increment - extracted to helper method
      const success = await this.sendTaskToWMSAndIncrement(
        [newTask],
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
    let haultedTasks = await this.taskRepository.find({
      where: {
        task_type: this.taskType,
        status: TaskStatus.HALTED,
        move_type: In([MOVE_TYPE.ZONE_TO_ZONE, MOVE_TYPE.ZONE_TO_DROP_ENTRY, MOVE_TYPE.DROP_ENTRY_TO_ZONE]),
      },
      relations: ['batch'],
      order: {
        batch: { priority: 'ASC' },
        priority: 'ASC'
      },
    });

    // Determine the first eligible halted task to process this cycle.
    const taskToProcess = haultedTasks.find((task) => {
      // Must have an end location to proceed.
      if (!task.end_location) return false;
      // For CROSSDOCK: if this is a DROP_ENTRY_TO_ZONE while its paired ZONE_TO_DROP_ENTRY (same priority) exists, skip it for now.
      if (
        task.task_type === TaskType.CROSSDOCK &&
        task.move_type === MOVE_TYPE.DROP_ENTRY_TO_ZONE &&
        haultedTasks.some(
          (t) =>
            t.priority === task.priority &&
            t.move_type === MOVE_TYPE.ZONE_TO_DROP_ENTRY
        )
      ) {
        return false;
      }
      return true;
    });

    if (taskToProcess) {
      if (taskToProcess.task_type === TaskType.CROSSDOCK) {
        await this.processCrossdockTask(taskToProcess);
      } else {
        await this.processBaseopsTask(taskToProcess);
      }
    }
  }

  // Helper method to avoid duplication
  private async sendTaskToWMSAndIncrement(
    tasks: Task[],
    batchPriority: number,
  ): Promise<boolean> {
    const req_tasks = tasks.map(task => ({
      task_id: task.task_id,
        task_type: this.taskType !== TaskType.CROSSDOCK ? this.taskType : TaskType.CROSSDOCK_INTERNAL,
        task_dependency: task.task_dependency,
        robot_id: task.robot_id,
        start_location: {
          location_id: task.start_location.location_id,
          location_type: task.start_location.location_type,
          location_action: task.start_location.location_action,
          location_dimension: task.start_location.location_dimension,
        },
        end_location: {
          location_id: task.end_location.location_id,
          location_type: task.end_location.location_type,
          location_action: task.end_location.location_action,
          location_dimension: task.end_location.location_dimension,
        },
        wait: task.wait,
        cargos: task.cargos,
      }
    ));

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
      const response = await fetch(
        `${wms_base_url}/robot-job/${warehouse_name}/tasks`,
        {
          method: 'POST',
          body: JSON.stringify(req_body),
          headers: {
            authorization: `${warehouse_key}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if(!response.ok) {
        throw new Error(`WMS API responded with status ${response.status}: ${response.statusText}`);
      }

      const responseData = await response.json();

      if(!responseData.batch_id) {
        throw new Error(`WMS API response missing batch_id: ${JSON.stringify(responseData)}`);
      }

      tasks.forEach(async (task) => {
        // Log dispatch success
      await this.loggingService.log(
          `Task ${task.task_id} sent to WMS API layer`,
          this.taskType,
          task.task_id,
          task.batch_id ?? null,
        );
      });

      if(req_tasks[0].task_type !== TaskType.CROSSDOCK_INTERNAL) {
        await this.incrementRobotInUse(); // ← Single increment point
      }

      tasks.forEach(async (task) => {
        await this.loggingService.log(
          `Robot in use incremented. Current robot in use: ${await this.getRobotInUse()}`,
          this.taskType,
          task.task_id,
          task.batch_id ?? null,
        );
        await this.taskRepository.update(
          { task_id: task.task_id },
          { status: TaskStatus.ASSIGNED, fms_batch_id: responseData.batch_id },
        );
      });
      return true;
    } catch (error) {
        await Promise.all(tasks.map(async (task) => {
        console.error(`Error sending task ${task.task_id} to WMS Layer:`, error);
        await this.loggingService.createErrorLog(
          `Error sending task ${task.task_id} to WMS Layer: ${error?.message ?? error}`,
          this.taskType,
          task.task_id,
          task.batch_id ?? null,
          true,
        );
        await this.loggingService.log(
          `Task ${task.task_id} failed to send to WMS. Releasing location ${task.end_location.location_id}`,
          this.taskType,
          task.task_id,
          task.batch_id ?? null,
        );
        await this.LocationManagerService.freeLocation(task.end_location.location_id);
        if (task.move_type === MOVE_TYPE.ZONE_TO_WAIT) {
          await this.taskRepository.delete({ task_id: task.task_id });
        }
      }));
      return false;
    }
  }

  async cancelTaskFromWMS(task: Task): Promise<void> {
     try {
      console.log(`Cancelling task ${task.task_id}`);
      const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
      const warehouse_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test'; // Fixed typo
      const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030';
      const fms_batch_id = task.fms_batch_id;
      
      const requestBody = {
        "force": true,
        "reason": "Cancelled via Crossdock Task Service",
        "timestamp": new Date().toISOString()
      };
      
      const response = await fetch(`${wms_base_url}/robot-job/${warehouse_name}/tasks/${fms_batch_id}/${task.task_id}/cancel`, {
        method: 'PATCH',
        headers: {
          'authorization': warehouse_key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        // Try to get error details
        let errorMessage = response.statusText;
        try {
          const errorData = await response.text();
          errorMessage = errorData || response.statusText;
        } catch (e) {
          // If can't read response, use statusText
        }
        throw new Error(`Failed to cancel task ${task.task_id}: ${errorMessage}`);
      }
      
      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      let res;
      if (contentType && contentType.includes('application/json')) {
        res = await response.json();
      } else {
        res = await response.text();
      }
      
      return;
      
    } catch (error) {
      console.error(`Error cancelling task ${task.task_id}:`, error);
      throw new Error(`Failed to cancel task ${task.task_id}: ${error.message}`);
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
      if (nextTask.task_type === TaskType.CROSSDOCK) {
        await this.processCrossdockTask(nextTask);
      } else {
        await this.processBaseopsTask(nextTask);
      }
      return nextTask.task_id;
    } catch (error) {
      console.error(
        `Error sending batch ${nextTask.batch.batch_id} to WMS Layer:`,
        error,
      );
      throw error;
    }
  }

  private async processBaseopsTask(task: Task): Promise<void> {
    const processedTask = await this.processTask(task);
    if (!processedTask) {
      console.log(
        `Task ${task.task_id} could not be processed, aborting WMS send.`,
      );
      return;
    } else {
      const success = await this.sendTaskToWMSAndIncrement(
        [processedTask],
        task.batch.priority,
      );

      if (!success) {
        await this.LocationManagerService.freeLocation(
          task.start_location.location_id,
        );
        await this.LocationManagerService.freeLocation(
          task.end_location.location_id,
        );
        console.log(
          `Task ${task.task_id} failed to send to WMS, locations released.`,
        );
        return;
      }
    }
  }

  private async processCrossdockTask(task: Task): Promise<void> {
    const originalTask = structuredClone(task);

    let tasks: Task[] = [];

    if(originalTask.move_type === MOVE_TYPE.ZONE_TO_ZONE) {
      const startEntryLocation = await this.LocationManagerService.getStartZoneEntryPoint(originalTask.start_location.location_attribute.attribute_zone_pair_id!);
      const endEntryLocation = await this.LocationManagerService.getEndZoneEntryPoint(originalTask.end_location.location_attribute.attribute_zone_pair_id!);

      const higherPriorityTasks = await this.taskRepository.find({
        where: {
          task_type: TaskType.CROSSDOCK,
          priority: MoreThan(originalTask.priority ?? Number.MAX_SAFE_INTEGER),
          move_type: MOVE_TYPE.PICK_ENTRY,
          status: In([TaskStatus.ASSIGNED, TaskStatus.INQUEUE, TaskStatus.PROCESSING])
        }
      });

      const validHigherPriorityTasks = higherPriorityTasks.filter(t => t.start_location.location_id === originalTask.start_location.location_id);

      if(validHigherPriorityTasks.length > 0 && originalTask.end_location.location_attribute.attribute_name === 'ZONE') {
        await this.markSystemAsWaiting();
        const destinationZone = originalTask.end_location.location_attribute.attribute_value;

        const dropLocationAffectedTasks = await this.taskRepository.find({
          where: {
            task_type: TaskType.CROSSDOCK,
            move_type: MOVE_TYPE.PICK_ENTRY,
            status: In([TaskStatus.ASSIGNED, TaskStatus.INQUEUE, TaskStatus.PROCESSING])
          }
        });

        for (const affectedTask of dropLocationAffectedTasks) {
          await this.handleCrossdockPickEntryCancellation(affectedTask, destinationZone);
        }
        await this.unmarkSystemAsWaiting();
      }

      if(startEntryLocation) {
        let toStartEntryTask = new Task()
        toStartEntryTask.batch_id = task.batch.batch_id;
        toStartEntryTask.wms_task_id = task.wms_task_id;
        toStartEntryTask.task_type = this.taskType;
        toStartEntryTask.status = TaskStatus.PENDING;
        toStartEntryTask.move_type = MOVE_TYPE.PICK_ENTRY;
        toStartEntryTask.sequence_order = originalTask.sequence_order;
        toStartEntryTask.task_dependency = originalTask.task_dependency;
        toStartEntryTask.priority = task.priority;

        toStartEntryTask.start_location = {
          location_id: startEntryLocation.location_id,
          location_type: LocationType.PALLET,
          location_action: LocationAction.NOP,
          location_dimension: {
            length: 1,
            width: 1,
            height: 1,
          },
          location_attribute: null as any,
        };

        toStartEntryTask.end_location = {
          location_id: startEntryLocation.location_id,
          location_type: LocationType.PALLET,
          location_action: LocationAction.NOP,
          location_dimension: {
            length: 1,
            width: 1,
            height: 1,
          },
          location_attribute: null as any,
        };

        toStartEntryTask.wait = null as any;
        toStartEntryTask.cargos = task.cargos;

        toStartEntryTask = await this.taskRepository.save(toStartEntryTask);
        tasks.push(toStartEntryTask);

        task.task_dependency = toStartEntryTask.task_id; 
        task.sequence_order = toStartEntryTask.sequence_order + 1;
        task = await this.taskRepository.save(task);
      } else {
        task.sequence_order = originalTask.sequence_order;
        task = await this.taskRepository.save(task);
      }

      if(endEntryLocation) {
        let fromEndEntryTask = new Task()
        fromEndEntryTask.batch_id = task.batch.batch_id;
        fromEndEntryTask.wms_task_id = task.wms_task_id;
        fromEndEntryTask.task_type = this.taskType;
        fromEndEntryTask.status = TaskStatus.PENDING;
        fromEndEntryTask.move_type = MOVE_TYPE.DROP_ENTRY_TO_ZONE;
        fromEndEntryTask.sequence_order = task.sequence_order + 1;
        fromEndEntryTask.task_dependency = task.task_id;
        fromEndEntryTask.priority = task.priority;

        fromEndEntryTask.start_location = {
          location_id: endEntryLocation.location_id,
          location_type: LocationType.PALLET,
          location_action: LocationAction.NOP_RESUME,
          location_dimension: {
            length: 1,
            width: 1,
            height: 1,
          },
          location_attribute: null as any,
        };

        fromEndEntryTask.end_location = task.end_location;

        fromEndEntryTask.wait = null as any;
        fromEndEntryTask.cargos = task.cargos;

        fromEndEntryTask = await this.taskRepository.save(fromEndEntryTask);

        task.move_type = MOVE_TYPE.ZONE_TO_DROP_ENTRY;
        task.end_location = {
          location_id: endEntryLocation.location_id,
          location_type: LocationType.PALLET,
          location_action: LocationAction.NOP_PAUSE,
          location_dimension: {
            length: 1,
            width: 1,
            height: 1,
          },
          location_attribute: null as any,
        };

        task = await this.taskRepository.save(task);

        tasks.push(task);
        tasks.push(fromEndEntryTask);
      } else {
        tasks.push(task);
      }
    } else if (originalTask.move_type === MOVE_TYPE.ZONE_TO_DROP_ENTRY) {
      const dependentTask = (await this.taskRepository.findOne({
        where: {
          task_dependency: task.task_id,
        },
      })) as Task;

      tasks.push(task);
      tasks.push(dependentTask);
    } else if (originalTask.move_type === MOVE_TYPE.DROP_ENTRY_TO_ZONE) {
      tasks.push(task);
    }

    if(originalTask.move_type === MOVE_TYPE.ZONE_TO_ZONE) {
      tasks[0].task_dependency = null as any;
    }

    const processedTasks: Task[] = [];
    for (const t of tasks) {
      const processedTask = await this.processTask(t);
      if (processedTask) {
        processedTasks.push(processedTask);
      }
    }

    let success = true;

    if(tasks.length !== processedTasks.length) {
      console.log(`Not all tasks could be processed, aborting WMS send.`);
      success = false;
    } else {
      success = await this.sendTaskToWMSAndIncrement(processedTasks, task.priority);
    }

    if(!success) {
      tasks.forEach(async (t) => {
        if (originalTask.move_type === MOVE_TYPE.ZONE_TO_ZONE) {
          if(t.move_type === MOVE_TYPE.ZONE_TO_DROP_ENTRY || t.move_type === MOVE_TYPE.ZONE_TO_ZONE) {
            originalTask.status = TaskStatus.HALTED;
            await this.taskRepository.save(originalTask);
          } else {
            await this.taskRepository.delete({ task_id: t.task_id });
          }
        } else if (originalTask.move_type === MOVE_TYPE.ZONE_TO_DROP_ENTRY || originalTask.move_type === MOVE_TYPE.DROP_ENTRY_TO_ZONE) {
          t.status = TaskStatus.HALTED;
          await this.taskRepository.save(t);
        }

        if(t.move_type === MOVE_TYPE.ZONE_TO_ZONE || t.move_type === MOVE_TYPE.ZONE_TO_DROP_ENTRY) {
          await this.LocationManagerService.occupyLocation(t.start_location.location_id);
        }
        if(t.move_type === MOVE_TYPE.ZONE_TO_ZONE || t.move_type === MOVE_TYPE.DROP_ENTRY_TO_ZONE) {
          const endLocation = await this.LocationManagerService.getLocation(t.end_location.location_id);
          if(endLocation?.location_status === LocationStatus.RESERVED) {
            await this.LocationManagerService.freeLocation(t.end_location.location_id);
          }
        }
      });
    } else {
      tasks.forEach(async (t) => {
        await this.taskRepository.update(
          { task_id: t.task_id },
          { status: TaskStatus.ASSIGNED },
        );
      });
    }
  }

  private async processTask(task: Task): Promise<Task | undefined> {
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
          task.end_location.location_attribute?.attribute_zone_pair_id,
        );
      if (!end_location_id) {
        if(task.task_type === TaskType.CROSSDOCK) {
          return;
        }
        // no optimal drop location found in the zone, look for the location in wait zone
        const startLocation = (await this.LocationManagerService.getLocation(task.start_location.location_id)) as LocationEntity;
        const startZoneId = startLocation?.parent_id || startLocation?.location_id;
        end_location_id =
          await this.LocationManagerService.getOptimalWaitLocation(
            task.end_location.location_attribute?.attribute_value,
            startZoneId,
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
      const end_location = await this.LocationManagerService.getLocation(
        task.end_location.location_id,
      );
      if(end_location?.location_type === LocationType.PALLET) { 
        const is_accessible = (await this.LocationManagerService.checkDropLocationsDirectAccessibility([task.end_location.location_id], false, task.end_location.location_attribute?.attribute_zone_pair_id))[0];
        if(is_accessible === true) {
          end_location_id = task.end_location.location_id;
        } else {
          return;
        }
      } else {
        end_location_id = task.end_location.location_id;
      }
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
        const startLocation = (await this.LocationManagerService.getLocation(task.start_location.location_id)) as LocationEntity;
        const startZoneId = startLocation?.parent_id || startLocation?.location_id;
        end_location_id =
        await this.LocationManagerService.getOptimalWaitLocation(
          task.end_location.location_attribute?.attribute_value,
          startZoneId,
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

    task.end_location.location_id = end_location_id;

    return task;
    // req_tasks.push({
    //   task_id: task.task_id,
    //   task_type: String(this.taskType),
    //   task_dependency: task.task_dependency,
    //   robot_id: task.robot_id,
    //   start_location: {
    //     location_id: task.start_location.location_id,
    //     location_type: task.start_location.location_type,
    //     location_action: task.start_location.location_action,
    //     location_dimension: task.start_location.location_dimension,
    //   },
    //   end_location: {
    //     location_id: end_location_id,
    //     location_type: task.end_location.location_type,
    //     location_action: task.end_location.location_action,
    //     location_dimension: task.end_location.location_dimension,
    //   },
    //   wait: task.wait,
    //   cargos: task.cargos,
    // });
    // const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
    // const warehouse_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
    // const wms_base_url =
    //   process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';
    // const req_body = {
    //   batch_type: 'DISCRETE',
    //   batch_priority: task.batch.priority,
    //   tasks: req_tasks,
    // };
    // try {
    //   await firstValueFrom(
    //     this.httpService.post(
    //       `${wms_base_url}/robot-job/${warehouse_name}/tasks`,
    //       req_body,
    //       {
    //         headers: {
    //           authorization: `${warehouse_key}`,
    //           'Content-Type': 'application/json',
    //         },
    //       },
    //     ),
    //   );
    // } catch (error) {
    //   console.error(
    //     `Error sending batch ${task.batch.batch_id} to WMS Layer:`,
    //     error,
    //   );
    //   await this.LocationManagerService.freeLocation(end_location_id);
    //   await this.loggingService.createErrorLog(
    //     `Error sending task ${task.task_id} to WMS Layer: ${error?.message ?? error}`,
    //     this.taskType,
    //     task.task_id,
    //     task.batch_id ?? null,
    //     true,
    //   );
    //   return;
    // }
    // await this.loggingService.log(
    //   `Task ${task.task_id} sent to WMS API layer`,
    //   this.taskType,
    //   task.task_id,
    //   task.batch_id ?? null,
    // );
    // await this.incrementRobotInUse();
    // await this.loggingService.log(
    //   `Robot in use incremented. Current robot in use: ${await this.getRobotInUse()}`,
    //   this.taskType,
    //   task.task_id,
    //   task.batch_id ?? null,
    // );
    // await this.taskRepository.update(
    //   { task_id: task.task_id },
    //   { status: TaskStatus.ASSIGNED },
    // );
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

    let batchPre = "";
    
    if (this.taskType === TaskType.GOODS_TO_PERSON) {
      batchPre = "GP"
    } else if (this.taskType === TaskType.BASEOPS) {
      batchPre = "BO"
    } else if (this.taskType === TaskType.CROSSDOCK) {
      batchPre = "CD"
    } else {
      batchPre = "B"
    }
    const batchId = `${batchPre}_${dateString}_${batchNumber}`;

    return batchId;
  }
  async processTasks(tasks: any[], priority: number, batch_job_id?: string): Promise<any> {

    if(batch_job_id) {
      const existingBatch = await this.batchRepository.findOne({ where: { wms_batch_id: batch_job_id } });
      if (existingBatch) {
        throw new Error(`Batch ID ${batch_job_id} already exists. Please use a unique batch ID.`);
      }
    }
    
    // Generate a batch
    const batch_id = await this.generateBatchId();
    const batch = this.batchRepository.create({
      batch_id: batch_id,
      wms_batch_id: batch_job_id,
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
      const startLocation = await this.LocationManagerService.getLocation(task['start_location_location_id']);
      const startZone = startLocation?.parent_id || startLocation?.location_id;

      const endLocation = await this.LocationManagerService.getLocation(task['end_location_location_id']);
      const endZone = endLocation?.parent_id || endLocation?.location_id;

      const zonePairId = await this.LocationManagerService.getZonePairId(startZone!, endZone!);

      const newTask = new Task();
      newTask.batch_id = batch.batch_id;
      newTask.task_type = this.taskType;
      newTask.status = TaskStatus.PENDING;
      newTask.move_type = MOVE_TYPE.ZONE_TO_ZONE;
      newTask.sequence_order = 1;
      newTask.task_dependency = null as any;
      newTask.robot_id = null as any;
      newTask.priority = task['priority'];
      newTask.wms_task_id = task['wms_task_id'] || null;

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
          attribute_zone_pair_id: zonePairId ?? undefined,
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
          attribute_zone_pair_id: zonePairId ?? undefined,
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

  // Step 1: Cancel chain of tasks derived from a PICK_ENTRY and return blueprint for recreation
  async cancelCrossdockPickEntryChain(
    currentTask: Task,
    destinationZone: string | null = null,
  ): Promise<Task | null> {
    const splitTasks: Task[] = [];
    let dependent = await this.taskRepository.findOne({
      where: { task_dependency: currentTask.task_id },
    });

    while (dependent) {
      splitTasks.push(dependent);
      dependent = await this.taskRepository.findOne({
        where: { task_dependency: dependent.task_id },
      });
    }

    if (
      destinationZone &&
      splitTasks.length > 0 &&
      splitTasks[splitTasks.length - 1].end_location?.location_attribute?.attribute_name === 'ZONE' &&
      splitTasks[splitTasks.length - 1].end_location.location_attribute.attribute_value !== destinationZone
    ) {
      return null;
    }

    const originalTask = new Task();
    originalTask.batch_id = currentTask.batch_id;
    originalTask.wms_task_id = currentTask.wms_task_id;
    originalTask.task_type = currentTask.task_type;
    originalTask.status = TaskStatus.PENDING;
    originalTask.move_type = MOVE_TYPE.ZONE_TO_ZONE;
    originalTask.sequence_order = 1;
    originalTask.priority = currentTask.priority;
    originalTask.start_location = {} as any;
    originalTask.end_location = {} as any;
    originalTask.cargos = currentTask.cargos ?? null;

    for (const dependentTask of splitTasks) {
      if (dependentTask.status !== TaskStatus.CANCELLED) {
        await this.cancelTaskFromWMS(dependentTask);
        dependentTask.status = TaskStatus.CANCELLED;
        await this.taskRepository.save(dependentTask);
        await this.loggingService.log(
          `Cancelled dependent task ${dependentTask.task_id} due to PICK_ENTRY cancellation of ${currentTask.task_id}`,
          TaskType.CROSSDOCK,
          dependentTask.task_id,
          dependentTask.batch_id ?? null,
        );
      }

      if (
        dependentTask.move_type === MOVE_TYPE.ZONE_TO_ZONE ||
        dependentTask.move_type === MOVE_TYPE.ZONE_TO_DROP_ENTRY
      ) {
        originalTask.start_location = dependentTask.start_location;
        await this.LocationManagerService.occupyLocation(
          dependentTask.start_location.location_id,
        );
      }

      if (dependentTask.end_location?.location_attribute) {
        originalTask.sequence_order = dependentTask.sequence_order + 1;
        originalTask.task_dependency = dependentTask.task_id;
        originalTask.end_location = {
          location_id:
            dependentTask.end_location.location_attribute.attribute_name === 'Pallet'
              ? dependentTask.end_location.location_attribute.attribute_value
              : 'To be decided',
          location_type: LocationType.PALLET,
          location_action: LocationAction.DROP,
          location_dimension: {
            length: 1,
            width: 1,
            height: 1,
          },
          location_attribute: dependentTask.end_location.location_attribute,
        } as any;
        const endLocation = await this.LocationManagerService.getLocation(
          dependentTask.end_location.location_id,
        ) as LocationEntity;
        if (endLocation.location_status === LocationStatus.RESERVED) {
          await this.LocationManagerService.freeLocation(
            dependentTask.end_location.location_id,
          );
        }
      }
    }

    if (currentTask.status != TaskStatus.CANCELLED) {
      await this.cancelTaskFromWMS(currentTask);
      currentTask.status = TaskStatus.CANCELLED;
      await this.taskRepository.save(currentTask);
    }

    return originalTask;
  }

  // Step 2: Recreate the original CROSSDOCK task from blueprint
  async recreateOriginalCrossdockTask(originalTask: Task): Promise<Task> {
    const saved = await this.taskRepository.save(originalTask);
    await this.loggingService.log(
      `Recreated original CROSSDOCK task ${saved.task_id} after PICK_ENTRY cancellation (from ${saved.start_location.location_id} to ${saved.end_location.location_id})`,
      TaskType.CROSSDOCK,
      saved.task_id,
      saved.batch_id,
    );
    return saved;
  }

  // Wrapper maintained for backward compatibility: cancels and (optionally) recreates
  async handleCrossdockPickEntryCancellation(
    currentTask: Task,
    destinationZone: string | null = null,
    createNewTask: boolean = true,
  ): Promise<string | void> {
    const originalTask = await this.cancelCrossdockPickEntryChain(
      currentTask,
      destinationZone,
    );

    if (!originalTask) return; // zone mismatch or nothing to do
    if (!createNewTask) return;

    const recreated = await this.recreateOriginalCrossdockTask(originalTask);
    return recreated.end_location.location_attribute.attribute_value;
  }

  async handleCrossdockDropEntryCancellation(currentTask: Task): Promise<void> {
    const nextTask = await this.taskRepository.findOne({ where: { task_dependency: currentTask.task_id } });
    if (!nextTask) return;

    const dropLocation = await this.LocationManagerService.getLocation(nextTask.end_location.location_id) as LocationEntity;
    // const crossdockWMSLocations = await this.LocationManagerService.getCrossdockEmptyLocations(dropLocation.parent_id);

    // for (const crossdockWMSLocation of crossdockWMSLocations) {
    //   const location = await this.LocationManagerService.getLocation(crossdockWMSLocation.id) as LocationEntity;
    //   if(crossdockWMSLocation.status === 'EMPTY' && location.location_status === LocationStatus.OCCUPIED) {
    //     await this.LocationManagerService.freeLocation(crossdockWMSLocation.id);
    //   } else if(crossdockWMSLocation.status === 'OCCUPIED' && location.location_status !== LocationStatus.OCCUPIED) {
    //     await this.LocationManagerService.occupyLocation(crossdockWMSLocation.id);
    //   }
    // }

    if((await this.LocationManagerService.checkDropLocationsDirectAccessibility([dropLocation.location_id], true, nextTask.end_location.location_attribute?.attribute_zone_pair_id))[0]) return;

    await this.cancelTaskFromWMS(nextTask);
    nextTask.status = TaskStatus.CANCELLED;
    await this.taskRepository.save(nextTask);

    const endLocation = await this.LocationManagerService.getLocation(nextTask.end_location.location_id) as LocationEntity;
    if(endLocation.location_status === LocationStatus.RESERVED) {
      await this.LocationManagerService.freeLocation(nextTask.end_location.location_id);
    }

    const newBatchesTasks: Map<number, Task[]> = new Map<number, Task[]>();

    const processingTasksToEntry = await this.taskRepository.find({
      where: {
        task_type: TaskType.CROSSDOCK,
        move_type: MOVE_TYPE.ZONE_TO_DROP_ENTRY,
        status: TaskStatus.PROCESSING
      },
    })

    for (const task of processingTasksToEntry) {
      if(task.end_location.location_id !== currentTask.end_location.location_id) continue;

      const dependentTask = await this.taskRepository.findOne({ where: { task_dependency: task.task_id }, relations: ['batch'] }) as Task;

      let zoneToDropEntryTask = structuredClone(task);
      zoneToDropEntryTask.task_id = undefined as any;
      zoneToDropEntryTask.status = TaskStatus.PENDING;
      zoneToDropEntryTask.start_location.location_id = currentTask.end_location.location_id;
      zoneToDropEntryTask.start_location.location_action = LocationAction.NOP;
      zoneToDropEntryTask.sequence_order = task.sequence_order + 1
      zoneToDropEntryTask = await this.taskRepository.save(zoneToDropEntryTask);

      let dropEntryToZoneTask = structuredClone(dependentTask);
      dropEntryToZoneTask.task_id = undefined as any;
      dropEntryToZoneTask.status = TaskStatus.PENDING;
      dropEntryToZoneTask.end_location.location_id = dependentTask.end_location.location_attribute.attribute_name === 'Pallet' ? dependentTask.end_location.location_id : 'To be decided';
      dropEntryToZoneTask.end_location.location_action = LocationAction.DROP;
      dropEntryToZoneTask.task_dependency = zoneToDropEntryTask.task_id;
      dropEntryToZoneTask.sequence_order = zoneToDropEntryTask.sequence_order + 1;
      dropEntryToZoneTask = await this.taskRepository.save(dropEntryToZoneTask);

      newBatchesTasks.set(dependentTask.batch.priority, [zoneToDropEntryTask, dropEntryToZoneTask]);

      await this.cancelTaskFromWMS(task);
      await this.cancelTaskFromWMS(dependentTask);

      task.status = TaskStatus.CANCELLED;
      await this.taskRepository.save(task);

      dependentTask.status = TaskStatus.CANCELLED;
      await this.taskRepository.save(dependentTask);

      const endLocation = await this.LocationManagerService.getLocation(dependentTask.end_location.location_id) as LocationEntity;
      if(endLocation.location_status === LocationStatus.RESERVED) {
        await this.LocationManagerService.freeLocation(dependentTask.end_location.location_id);
      }
    }

    const inqueueTasksToEntry = await this.taskRepository.find({
      where: {
        task_type: TaskType.CROSSDOCK,
        move_type: MOVE_TYPE.ZONE_TO_DROP_ENTRY,
        status: TaskStatus.INQUEUE
      }
    });

    for (const task of inqueueTasksToEntry) {
      if(task.end_location.location_id !== currentTask.end_location.location_id) continue;

      const dependentTask = await this.taskRepository.findOne({ where: { task_dependency: task.task_id }, relations: ['batch'] }) as Task;

      let zoneToDropEntryTask = structuredClone(task);
      zoneToDropEntryTask.task_id = undefined as any;
      zoneToDropEntryTask.status = TaskStatus.PENDING;
      zoneToDropEntryTask.sequence_order = task.sequence_order + 1;
      zoneToDropEntryTask = await this.taskRepository.save(zoneToDropEntryTask);

      let dropEntryToZoneTask = structuredClone(dependentTask);
      dropEntryToZoneTask.task_id = undefined as any;
      dropEntryToZoneTask.status = TaskStatus.PENDING;
      dropEntryToZoneTask.end_location.location_id = dependentTask.end_location.location_attribute.attribute_name === 'Pallet' ? dependentTask.end_location.location_id : 'To be decided';
      dropEntryToZoneTask.end_location.location_action = LocationAction.DROP;
      dropEntryToZoneTask.task_dependency = zoneToDropEntryTask.task_id;
      dropEntryToZoneTask.sequence_order = zoneToDropEntryTask.sequence_order + 1;
      dropEntryToZoneTask = await this.taskRepository.save(dropEntryToZoneTask);

      newBatchesTasks.set(dependentTask.batch.priority, [zoneToDropEntryTask, dropEntryToZoneTask]);

      await this.cancelTaskFromWMS(task);
      await this.cancelTaskFromWMS(dependentTask);

      task.status = TaskStatus.CANCELLED;
      await this.taskRepository.save(task);

      dependentTask.status = TaskStatus.CANCELLED;
      await this.taskRepository.save(dependentTask);

      await this.LocationManagerService.occupyLocation(task.start_location.location_id);

      const endLocation = await this.LocationManagerService.getLocation(dependentTask.end_location.location_id) as LocationEntity;
      if(endLocation.location_status === LocationStatus.RESERVED) {
        await this.LocationManagerService.freeLocation(dependentTask.end_location.location_id);
      }
    }

    const assignedTasksToEntry = await this.taskRepository.find({
      where: {
        task_type: TaskType.CROSSDOCK,
        move_type: MOVE_TYPE.ZONE_TO_DROP_ENTRY,
        status: TaskStatus.ASSIGNED
      }
    });

    const cancelledOriginalTasksToPickEntry: Task[] = []

    for (const task of assignedTasksToEntry) {
      const prevTask = await this.taskRepository.findOne({ where: { task_id: task.task_dependency } }) as Task;
      const originalTask = await this.cancelCrossdockPickEntryChain(prevTask, nextTask.end_location.location_attribute.attribute_value);
      if (originalTask) {
        cancelledOriginalTasksToPickEntry.push(originalTask);
      }
    }
    
    let newNextTask = structuredClone(nextTask);
    newNextTask.task_id = undefined as any;
    newNextTask.status = TaskStatus.PENDING;
    newNextTask.start_location.location_id = currentTask.end_location.location_id;
    newNextTask.start_location.location_action = LocationAction.NOP;
    newNextTask.end_location.location_id = nextTask.end_location.location_attribute.attribute_name === 'Pallet' ? nextTask.end_location.location_id : 'To be decided';
    newNextTask.task_dependency = currentTask.task_id;
    newNextTask.sequence_order = nextTask.sequence_order + 1;
    newNextTask = await this.taskRepository.save(newNextTask);
    const processedNewNextTask = await this.processTask(newNextTask) as Task;
    if(!processedNewNextTask) {
      await this.taskRepository.update(
        { task_id: newNextTask.task_id },
        { status: TaskStatus.HALTED },
      );
      await this.loggingService.log(
        `Failed to process recreated DROP_ENTRY to ZONE task after DROP_ENTRY cancellation of ${currentTask.task_id}`,
        TaskType.CROSSDOCK, null, newNextTask.batch_id,
      );
      return;
    }

    await this.sendTaskToWMSAndIncrement([processedNewNextTask], currentTask.priority);

    const newBatchesTasksPriorities = Array.from(newBatchesTasks.keys()).sort((a, b) => a - b);

    for (const priority of newBatchesTasksPriorities) {
      const tasks = newBatchesTasks.get(priority) || [];
      const processedTasks: Task[] = [];
      for (const task of tasks) {
        const processedTask = await this.processTask(task);
        if (processedTask) {
          processedTasks.push(processedTask);
        }
      }

      let success = true;

      if(tasks.length !== processedTasks.length) {
        console.log(`Not all tasks could be processed, aborting WMS send.`);
        success = false;
      } else {
        success = await this.sendTaskToWMSAndIncrement(processedTasks, priority);
      }

      if(!success) {
        tasks.forEach(async (t) => {
          await this.taskRepository.update(
            { task_id: t.task_id },
            { status: TaskStatus.HALTED },
          );
          const endLocation = await this.LocationManagerService.getLocation(t.start_location.location_id) as LocationEntity;
          if(endLocation.location_status === LocationStatus.OCCUPIED) {
            await this.LocationManagerService.freeLocation(t.start_location.location_id);
          }
        });
      } else {
        tasks.forEach(async (t) => {
          await this.taskRepository.update(
            { task_id: t.task_id },
            { status: TaskStatus.ASSIGNED },
          );
        });
      }
    }

    for (const task of cancelledOriginalTasksToPickEntry) {
      await this.recreateOriginalCrossdockTask(task);
    }
  }
}
