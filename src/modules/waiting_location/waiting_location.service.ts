import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { CreateWaitingLocationDto } from './dto/create-waiting_location.dto';
import { UpdateWaitingLocationDto } from './dto/update-waiting_location.dto';
import { WaitingLocation } from 'src/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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
      throw new Error(`Waiting location with id ${createWaitingLocationDto.location_id} already exists`);
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
    await this.waitingLocationRepository.update({ location_id: id }, updateWaitingLocationDto);
    return await this.waitingLocationRepository.findOne({ where: { location_id: id } });
  }

  async remove(id: string) {
    const existing = await this.waitingLocationRepository.findOne({ where: { location_id: id } });
    if (!existing) {
      throw new Error(`Waiting location with id ${id} not found`);
    }
    if (existing.holded_by){
      throw new ConflictException(`Cannot delete waiting location ${id} as it is currently holded by ${existing.holded_by}`);
    }
    await this.waitingLocationRepository.delete({ location_id: id });
    return { message: `Waiting location with id ${id} deleted successfully` };
  }
}
