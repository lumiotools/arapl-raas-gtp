import { Inject, Injectable } from '@nestjs/common';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Settings } from 'src/entities/settings.entity';
import { In, Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { LocationAction, Task, TaskStatus, TaskType } from 'src/entities';
import { MOVE_TYPE } from 'src/entities/task.entity';
import { isIn } from 'class-validator';
import { Robot } from 'src/entities/robots.entity';
import { LoggingService } from 'src/services/logging.service';

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
      where: { task_type: task_type['task_type'] },
    });
    const res: any[] = [];
    if (robots.length === 0) {
      return res;
    }
    for (const robot of robots) {
      let robot_task: Task | null = null;
      if (robot.in_use){
        robot_task = await this.taskRepository.findOne({
          where: { robot_id: robot.robot_id, status: In([TaskStatus.PROCESSING, TaskStatus.COMPLETED]) },
          order: { created_at: 'DESC' }
        });
      }
      res.push({
        'id': robot.robot_id,
        'status': robot.is_active ? (robot.in_use ? 'working' : 'idle') : 'inactive',
        'travel_status': robot_task ? (robot_task.status === TaskStatus.PROCESSING ? `MOVING TO ${robot_task.end_location.location_id}` : (robot_task.status === TaskStatus.COMPLETED ? `REACHED ${robot_task.end_location.location_id}` : `IDLE`)) : (robot.is_active ? '-' : 'INACTIVE'),
        'in_use': robot.in_use,
        'current_status_time': robot.updated_at ? (Date.now() - new Date(robot.updated_at).getTime()) / 1000 : 0,
        'reason': robot.message_code ? robot.message_code : null
      });
    }
    return res;
  }

  async updateRobot(robotId: string, message_code: 'maintenance' | 'charging' | 'error' | null) {
    try{
      const robot = await this.robotRepository.findOne({ where: { robot_id: robotId } });
      if (!robot) {
        throw new Error(`Robot with ID ${robotId} not found`);
      }
      robot.is_active = !robot.is_active;
      robot.message_code = message_code;
      await this.robotRepository.save(robot);
      
      await this.loggingService.log(`Robot ${robotId} is now ${robot.is_active ? 'active' : 'inactive'}`, robot.task_type, null, null);   
      return { message: `Robot ${robotId} is now ${robot.is_active ? 'active' : 'inactive'}` };
    } catch (error) {
      throw new Error(`Failed to update robot: ${error.message}`);
    }
  }
}
