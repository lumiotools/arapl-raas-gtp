import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateWaitingLocationDto } from './dto/create-waiting_location.dto';
import { UpdateWaitingLocationDto } from './dto/update-waiting_location.dto';
import { Task, TaskStatus, TaskType, WaitingLocation } from 'src/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LocationStatus } from 'src/entities/station.entity';
import { firstValueFrom } from 'rxjs';
import { WaitingLocationType } from 'src/entities/waiting-location.entity';

@Injectable()
export class WaitingLocationService {
  httpService: any;
  constructor(
    @InjectRepository(WaitingLocation)
    private readonly waitingLocationRepository: Repository<WaitingLocation>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>
  ){}
  async create(createWaitingLocationDto: CreateWaitingLocationDto) {
    // throw new ConflictException('Waiting location creation is not allowed');
    const existingWaitLocation = await this.waitingLocationRepository.findOne({
      where:{location_id: createWaitingLocationDto.location_id}
    });
    if (existingWaitLocation) {
      throw new ConflictException(`Waiting location with id ${createWaitingLocationDto.location_id} already exists`);
    }
    const newWaitingLocation = this.waitingLocationRepository.create(createWaitingLocationDto);
    return this.waitingLocationRepository.save(newWaitingLocation);
  }

  async getAllWmsWaiting(){
    try{
      const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
      const warehosue_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
      const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';
      console.log(`Fetching WMS locations from ${wms_base_url}`);
      const response = await fetch(`${wms_base_url}/robot-job/${warehouse_name}/locations?location_zone=wait&location_type=wait`, {
        method: 'GET',
        headers: {
          'authorization': `${warehosue_key}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await response.json();
      console.log(`response: ${JSON.stringify(data)}`);
      return data;
    }catch{
      throw new BadRequestException('Failed to fetch WMS stations');
    }
    
  }

  async findAll() {
    const waiting_object = (await this.getAllWmsWaiting());
    const waiting_bin_locations = waiting_object.available_location_types || [];
    const bin_ids = waiting_bin_locations.map(bin => bin.location_id);
    const allWaitingLocations = await this.waitingLocationRepository.find();

    // find bin_ids that are not in allWaitingLocations
    const missingBinIds = bin_ids.filter(id => !allWaitingLocations.some(location => location.location_id === id));
    for (const missingId of missingBinIds) {
      await this.create({
        location_id: missingId,
        location_name: waiting_bin_locations.filter(bin => bin.location_id === missingId)[0].customer_location_id,
        type: WaitingLocationType.STATION_TO_STATION
      });
    }
    // find allWaitingLocations ids that are not in bin_ids
    const existingWaitingLocationIds = allWaitingLocations.map(location => location.location_id);
    const missingWaitingLocationIds = existingWaitingLocationIds.filter(id => !bin_ids.includes(id));
    if (missingWaitingLocationIds.length > 0) {
      // await this.waitingLocationRepository.delete(missingWaitingLocationIds);
      for (const id of missingWaitingLocationIds) {
        // await this.remove(id);
        this.waitingLocationRepository.update(
          { location_id: id },
          { is_active: false }
        );
      }
    }

    // find intersecting location IDs
      // const intersectingLocationIds = bin_ids.filter(id => existingWaitingLocationIds.includes(id));
      // for (const id of intersectingLocationIds) {
      //   const waitLocation = allWaitingLocations.filter(location => location.location_id === id)[0];
      //   if (waitLocation.is_active === false) {
      //     await this.waitingLocationRepository.update(
      //       { location_id: id },
      //       { is_active: true }
      //     );
      //   }
      // }
    return await this.waitingLocationRepository.find();
  }

  async findOne(id: string) {
    return await this.waitingLocationRepository.findOne({ where: { location_id: id } });
    const waiting_object = await this.getAllWmsWaiting();
    const bin_locations = waiting_object.available_location_types || [];
    const binLocation = bin_locations.find((bin: { location_id: string }) => bin.location_id === id);
    if (!binLocation) {
      const existing = await this.waitingLocationRepository.findOne({ where: { location_id: id } });
      if (existing) {
        this.waitingLocationRepository.update(
          { location_id: id },
          { is_active: false }
        );
        return existing;
      }
      throw new NotFoundException(`Waiting location with id ${id} not found in WMS bin locations`);
    }
    let waitingLocation = await this.waitingLocationRepository.findOne({
      where: { location_id: id }
    });
    if (waitingLocation?.is_active==false){
        await this.waitingLocationRepository.update(
          { location_id: id },
          { is_active:true }
        );
      }
    if (!waitingLocation) {
      // Create new waiting location if not exists
      waitingLocation = await this.create({
        location_id: id,
        location_name: id,
        type: WaitingLocationType.STATION_TO_STATION
      });
    }
    return waitingLocation;
  }

  async update(id: string, updateWaitingLocationDto: UpdateWaitingLocationDto) {
    if (id !== updateWaitingLocationDto.location_id) {
      throw new ConflictException(`ID update is not allowed`);
    }
    const existing = await this.waitingLocationRepository.findOne({ where: { location_id: id } });
    if (!existing) {
      throw new Error(`Waiting location with id ${id} not found`);
    }
    if (existing.location_id !== updateWaitingLocationDto.location_id) {
      throw new ConflictException(`Cannot change location_id of waiting location ${id}`);
    }
    if (existing.holded_by) {
      throw new ConflictException(`Cannot update waiting location ${id}. Some robot is holding it.`);
    }
    if (existing.status !== 'AVAILABLE') {
      throw new ConflictException(`Cannot update waiting location ${id} as it is not in AVAILABLE status`);
    }
    await this.waitingLocationRepository.update({ location_id: id }, updateWaitingLocationDto);
    return await this.waitingLocationRepository.findOne({ where: { location_id: id } });
  }

  async remove(id: string) {
    // throw new ConflictException('Waiting location removal is not allowed');
    const existing = await this.waitingLocationRepository.findOne({ where: { location_id: id } });
    if (!existing) {
      throw new Error(`Waiting location with id ${id} not found`);
    }
    if (existing.holded_by){
      throw new ConflictException(`Cannot delete waiting location ${id}. Some robot is holding it.`);
    }
    await this.waitingLocationRepository.delete({ location_id: id });
    return { message: `Waiting location with id ${id} deleted successfully` };
  }

  async reserveWaitingLocation(location_id: string): Promise<boolean> {
    const queryRunner = this.waitingLocationRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
        // Single atomic operation: Update only if status is AVAILABLE
        const result = await queryRunner.manager
            .createQueryBuilder()
            .update(WaitingLocation)
            .set({ status: LocationStatus.RESERVED })
            .where("location_id = :location_id AND status = :status AND is_active = :active", {
                location_id: location_id,
                status: LocationStatus.AVAILABLE,
                active: true
            })
            .execute();

        // If no rows were affected, location was either not found or not available
        if (result.affected === 0) {
            await queryRunner.rollbackTransaction();
            return false;
        }

        await queryRunner.commitTransaction();
        return true;

    } catch (error) {
        await queryRunner.rollbackTransaction();
        return false;
    } finally {
        await queryRunner.release();
    }
  }

  async getActiveRobotAtWaiting(waiting_location_id: string){
    const tasks = await this.taskRepository.find({
      where: { status: In([TaskStatus.COMPLETED, TaskStatus.PROCESSING, TaskStatus.INQUEUE]) },
      order: { created_at: 'DESC' }
    });

    // Filter to get only the last task of each batch
    const lastTasksPerBatch = new Map<string, Task>();
    for (const task of tasks) {
      if (task.batch_id) {
        if (!lastTasksPerBatch.has(task.batch_id) || 
            task.created_at > lastTasksPerBatch.get(task.batch_id)!.created_at) {
          lastTasksPerBatch.set(task.batch_id, task);
        }
      }
    }
    const filteredTasks = Array.from(lastTasksPerBatch.values());
    let robot_id : string | null = null;
    let robot_task : Task | null = null;
    for (const task of filteredTasks){
      if (task.end_location.location_attribute.attribute_value=='waiting_location' && task.end_location.location_id==waiting_location_id){
        robot_id = task.robot_id;
        robot_task = task;
        break;
      }
    }
    const waitingLocation = await this.waitingLocationRepository.findOne({
      where: { location_id: waiting_location_id },
    });
    if (!waitingLocation) {
      throw new BadRequestException("Waiting location not found")
    }
    let status: TaskStatus | null | string = null;
    if (robot_task) {
      status = robot_task.status;
      if (status === TaskStatus.PROCESSING) {
        status = "COMING";
      }
      else if (status === TaskStatus.COMPLETED) {
        status = "REACHED";
      }
    }
    console.log(`status: ${status}`)
    if (!robot_id){return {robot_id: null}}
    return {
      robot_id: robot_id,
      source: robot_task?.start_location.location_id || null,
      status: status,
      completed_time: robot_task?.completed || null
    }
  }
}
