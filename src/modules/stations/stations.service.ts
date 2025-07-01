import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { CreateStationDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/update-station.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Station } from 'src/entities/station.entity';

@Injectable()
export class StationsService {
  constructor(
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
  ) {}

  async create(createStationDto: CreateStationDto) {
    const existing = await this.stationRepository.findOne({
      where: { station_id: createStationDto.station_id },
    });
    if (existing) {
      throw new BadRequestException(`Station with id ${createStationDto.station_id} already exists`);
    }
    const newStation = this.stationRepository.create(createStationDto);
    return await this.stationRepository.save(newStation);
  }

  findAll() {
    return this.stationRepository.find({
      relations: ['gtpLocations'],
      order: { priority: 'ASC' }
    });
  }

  async findOne(id: string) {
    const station =  await this.stationRepository.findOne({
      where: { station_id: id },
      relations: ['gtpLocations']
    });
    if (!station){
      throw new NotFoundException(`Station with id ${id} not found`);
    }
    return station;
  }

  async update(id: string, updateStationDto: UpdateStationDto) {
    const existing = await this.stationRepository.findOne({ where: { station_id: id } });
    if (!existing) {
      throw new NotFoundException(`Station with id ${id} not found`);
    }
    return this.stationRepository.update(id, updateStationDto).then(() => {
      return this.stationRepository.findOne({
        where: { station_id: id },
        relations: ['gtpLocations']
      });
    });
  }

  async remove(id: string) {
    const existing = await this.stationRepository.findOne({ where: { station_id: id } });
    if (!existing) {
      throw new NotFoundException(`Station with id ${id} not found`);
    }
    return this.stationRepository.delete(id).then(() => {
      return { message: `Station with id ${id} has been removed` };
    });
  }
}
