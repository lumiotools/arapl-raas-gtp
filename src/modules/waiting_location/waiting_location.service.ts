import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateWaitingLocationDto } from './dto/create-waiting_location.dto';
import { UpdateWaitingLocationDto } from './dto/update-waiting_location.dto';
import { WaitingLocation } from 'src/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LocationStatus } from 'src/entities/station.entity';

@Injectable()
export class WaitingLocationService {
  constructor(
    @InjectRepository(WaitingLocation)
    private readonly waitingLocationRepository: Repository<WaitingLocation>,
  ){}
  async create(createWaitingLocationDto: CreateWaitingLocationDto) {
    const existingWaitLocation = await this.waitingLocationRepository.findOne({
      where:{location_id: createWaitingLocationDto.location_id}
    });
    if (existingWaitLocation) {
      throw new ConflictException(`Waiting location with id ${createWaitingLocationDto.location_id} already exists`);
    }
    const newWaitingLocation = this.waitingLocationRepository.create(createWaitingLocationDto);
    return this.waitingLocationRepository.save(newWaitingLocation);
  }

  async findAll() {
    return this.waitingLocationRepository.find();
  }

  async findOne(id: string) {
    return await this.waitingLocationRepository.findOne({ where: { location_id: id } });
  }

  async update(id: string, updateWaitingLocationDto: UpdateWaitingLocationDto) {
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
        const waitingLocation = await queryRunner.manager.findOne(WaitingLocation, { where: { location_id: location_id } });

        if (!waitingLocation) {
          return false;
        }

        if (waitingLocation.status !== LocationStatus.AVAILABLE) {
          return false;
        }

        waitingLocation.status = LocationStatus.RESERVED;
        await queryRunner.manager.save(WaitingLocation, waitingLocation);

        await queryRunner.commitTransaction();
  
        // Return the updated inventory (with isProcessing = true)
        return true;
      } catch (error) {
        await queryRunner.rollbackTransaction();
        return false;
      } finally {
        await queryRunner.release();
      }
    }
}
