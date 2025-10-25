import { Inject, Injectable } from '@nestjs/common';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Settings } from 'src/entities/settings.entity';
import { In, Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { LocationAction, RobotCount, Task, TaskStatus, TaskType } from 'src/entities';
import { MOVE_TYPE } from 'src/entities/task.entity';
import { isIn } from 'class-validator';
import { Robot, RobotStatus } from 'src/entities/robots.entity';
import { LoggingService } from 'src/services/logging.service';
import { OperationType } from 'src/entities/robot-count.entity';

@Injectable()
export class SettingsService {
  constructor(
    private readonly httpService: HttpService,
    @InjectRepository(Settings)
    private settingsRepository: Repository<Settings>,
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
    @InjectRepository(Robot)
    private robotRepository: Repository<Robot>,
    @InjectRepository(RobotCount)
    private robotCountRepository: Repository<RobotCount>,
    private readonly loggingService: LoggingService,
  ){}
  create(createSettingDto: CreateSettingDto) {
    return 'This action adds a new setting';
  }

  async findAll() {
    return await this.settingsRepository.find();
  }

  async findOne(id: number) {
    return `This action returns a #${id} setting`;
  }

  update(id: number, updateSettingDto: UpdateSettingDto) {
    return `This action updates a #${id} setting`;
  }

  remove(id: number) {
    return `This action removes a #${id} setting`;
  }

  async getAllRobots(task_type: TaskType) {
    const robots = await this.robotRepository.find({
      where: { task_type: task_type },
    });
    const res: any[] = [];
    if (robots.length === 0) {
      return res;
    }
    for (const robot of robots) {
      let robot_task: Task | null = null;
      if (robot.status === RobotStatus.INUSE){
        robot_task = await this.taskRepository.findOne({
          where: { robot_id: robot.robot_id, status: In([TaskStatus.PROCESSING, TaskStatus.COMPLETED]) },
          order: { created_at: 'DESC' }
        });
      }
      res.push({
        'id': robot.robot_id,
        'status': robot.status,
        'travel_status': robot_task ? (robot_task.status === TaskStatus.PROCESSING ? `MOVING TO ${robot_task.end_location.location_id}` : (robot_task.status === TaskStatus.COMPLETED ? `REACHED ${robot_task.end_location.location_id}` : `IDLE`)) : (robot.status === RobotStatus.ONLINE ? '-' : 'INACTIVE'),
        'current_status_time': robot.updated_at ? (Date.now() - new Date(robot.updated_at).getTime()) / 1000 : 0,
        'reason': robot.message_code ? robot.message_code : null
      });
    }
    return res;
  }

  async updateRobot(robotId: string, status: RobotStatus, reason: string|null) {
    try{
      const robot = await this.robotRepository.findOne({ where: { robot_id: robotId } });
      if (!robot) {
        throw new Error(`Robot with ID ${robotId} not found`);
      }
      if (!robot.logs){
        robot.logs = [];
      }
      console.log(`reason: ${reason}`);
      robot.logs.push({
        timestamp: new Date(),
        previous_status: robot.status,
        new_status: status,
        reason: reason,
      });
      robot.status = status;
      robot.message_code = reason;
      
      await this.robotRepository.save(robot);
      await this.loggingService.log(`Robot ${robotId} is now ${robot.status}`, robot.task_type, null, null);
      return { message: `Robot ${robotId} is now ${robot.status}` };
    } catch (error) {
      throw new Error(`Failed to update robot: ${error.message}`);
    }
  }

  async getAllRobotsInUse(task_type: TaskType) {
    const operationType = task_type['task_type'] === TaskType.BASEOPS ? OperationType.BASEOPS : OperationType.FLOWOPS;
    const robots = await this.robotCountRepository.find({
      where: { operation_type: operationType },
    });
    return {
      "total_robots": robots.length > 0 ? robots[0].total_robots : 0,
      "robot_in_use": robots.length > 0 ? robots[0].robot_in_use : 0,
      "is_waiting": robots.length > 0 ? robots[0].is_waiting : false,
    };
  }
}
