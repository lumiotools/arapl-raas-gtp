import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { CreateEmptyLocationDto } from './dto/create-empty_location.dto';
import { UpdateEmptyLocationDto } from './dto/update-empty_location.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { empty } from 'rxjs';
import { In, Repository } from 'typeorm';
import { EmptyLocation } from 'src/entities/empty-location.entity';
import { LocationStatus } from 'src/entities/station.entity';
import { InventoryService } from '../inventory/inventory.service';
import { Task } from 'src/entities';
import { MOVE_TYPE } from 'src/entities/task.entity';
import { Settings } from 'src/entities/settings.entity';
import { OperationType } from 'src/entities/robot-count.entity';

@Injectable()
export class EmptyLocationsService {
  constructor(
    @InjectRepository(EmptyLocation)
    private readonly emptyLocationRepository: Repository<EmptyLocation>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Settings)
    private readonly settingsRepository: Repository<Settings>,
    private readonly inventoryService: InventoryService,
  ) {}
  async create(createEmptyLocationDto: {location_id: string, location_name: string, is_active: boolean, priority: number}) {
    // throw new ConflictException('Waiting location creation is not allowed');
    const existingWaitLocation = await this.emptyLocationRepository.findOne({
      where:{location_id: createEmptyLocationDto.location_id}
    });
    console.log(`existingWaitLocation: ${JSON.stringify(existingWaitLocation)}`);
    if (existingWaitLocation) {
      throw new ConflictException(`Waiting location with id ${createEmptyLocationDto.location_id} already exists`);
    }
    const newWaitingLocation = this.emptyLocationRepository.create(createEmptyLocationDto);
    return this.emptyLocationRepository.save(newWaitingLocation);
  }

  async getAllWmsEmtpy(){
    try{
      const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
      const warehosue_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
      const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';
      console.log(`Fetching WMS locations from ${wms_base_url}`);
      const response = await fetch(`${wms_base_url}/robot-job/${warehouse_name}/locations?location_zone=empty&location_type=empty`, {
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
    const empty_object = (await this.getAllWmsEmtpy());
    const empty_bin_locations = empty_object.available_location_types || [];
    const bin_ids = empty_bin_locations.map(bin => bin.location_id);
    const allEmptyLocations: any[] = await this.emptyLocationRepository.find();

    // find bin_ids that are not in allEmptyLocations
    const missingBinIds = bin_ids.filter(id => !allEmptyLocations.some(location => location.location_id === id));
    let priority = 1;
    for (const missingId of missingBinIds) {
      await this.create({
        location_id: missingId,
        location_name: missingId,
        is_active: true,
        priority: priority++
      });
    }
    // find allEmptyLocations ids that are not in bin_ids
    const existingEmptyLocationIds = allEmptyLocations.map(location => location.location_id);
    const missingEmptyLocationIds = existingEmptyLocationIds.filter(id => !bin_ids.includes(id));
    if (missingEmptyLocationIds.length > 0) {
      // await this.waitingLocationRepository.delete(missingWaitingLocationIds);
      for (const id of missingEmptyLocationIds) {
        // await this.remove(id);
        this.emptyLocationRepository.update(
          { location_id: id },
          { is_active: false }
        );
      }
    }

    // find intersecting location IDs
    const intersectingLocationIds = bin_ids.filter(id => existingEmptyLocationIds.includes(id));
    for (const id of intersectingLocationIds) {
      const emptyLocation = allEmptyLocations.filter(location => location.location_id === id)[0];
      if (emptyLocation.is_active === false) {
        await this.emptyLocationRepository.update(
          { location_id: id },
          { is_active: true }
        );
      }
    }
    const recentTasks = await this.taskRepository.find({
      where: { move_type: In([MOVE_TYPE.STATION_TO_EMPTY_LOCATION, MOVE_TYPE.WAITING_LOCATION_TO_EMPTY_LOCATION, MOVE_TYPE.EMPTY_TO_EMPTY_LOCATION]) }, order: {created_at: 'DESC'}
    });
    const currentEmptyLocations: any[] = await this.emptyLocationRepository.find();
    for (let i = 0; i < currentEmptyLocations.length; i++) {
      currentEmptyLocations[i].current_pallet = null;
      const requiredTask = recentTasks.find(task => task.end_location.location_id === currentEmptyLocations[i].location_id);
      if (!requiredTask) {
        continue;
      }
      currentEmptyLocations[i].current_pallet = requiredTask.cargos ? requiredTask?.cargos[0]?.cargo_code : null;
    }
    return currentEmptyLocations;
  }

  async reserveEmptyLocation(location_id: string): Promise<boolean> {
    const queryRunner = this.emptyLocationRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
        // Single atomic operation: Update only if status is AVAILABLE
        const result = await queryRunner.manager
            .createQueryBuilder()
            .update(EmptyLocation)
            .set({ status: LocationStatus.RESERVED })
            .where("location_id = :location_id AND status = :status", {
                location_id: location_id,
                status: LocationStatus.AVAILABLE
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

  async findOne(id: string) {
    return await this.emptyLocationRepository.findOne({ where: { location_id: id } });
  }

  async update(id: string, updateEmptyLocationDto: {
    id: string,
    location_name: string,
    status: string,
    priority: number
  }) {
    await this.emptyLocationRepository.update({ location_id: id }, {
      location_name: updateEmptyLocationDto.location_name,
      status: updateEmptyLocationDto.status as LocationStatus,
      priority: updateEmptyLocationDto.priority
    });
    return this.findOne(id);
  }

  remove(id: string) {
    this.emptyLocationRepository.delete({ location_id: id });
    return `This action removes a #${id} emptyLocation`;
  }

  async updateAllocation(
    allocationType: 'ROUND_ROBIN' | 'MANUAL'
  ) {
    const settings = await this.settingsRepository.findOne({where:{operation_type: OperationType.FLOWOPS}});
    if (!settings){
      await this.settingsRepository.save({
        id: crypto.randomUUID(),
        operation_type: OperationType.FLOWOPS,
        value: {
          "EMPTY_LOCATION": allocationType,
        }
      });
      return;
    }
    settings.value = {
      ...settings.value,
      "EMPTY_LOCATION": allocationType,
    };
    await this.settingsRepository.save(settings);
    return settings;
  }
}
