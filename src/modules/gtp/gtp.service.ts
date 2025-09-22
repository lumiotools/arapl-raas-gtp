import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { CreateGtpDto } from './dto/create-gtp.dto';
import { UpdateGtpDto } from './dto/update-gtp.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GtpLocation } from 'src/entities/gtp-location.entity'; // Assuming you have a Gtp entity defined
import { Station } from 'src/entities/station.entity';
import { OrderItem, OrderItemStatus } from 'src/entities/order-item.entity';

@Injectable()
export class GtpService {
  constructor(
    @InjectRepository(GtpLocation)
    private readonly gtpRepository: Repository<GtpLocation>,
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
  ) {}
  async create(createGtpDto: GtpLocation) {
    // Check if station_id exists in Station repository
    if (createGtpDto.station_id !== undefined){
      const station = await this.stationRepository.findOne({ where: { station_id: createGtpDto.station_id } });
      if (!station) {
        throw new NotFoundException(`Station with id ${createGtpDto.station_id} not found`);
      }
    }
    const existingGtp = await this.gtpRepository.findOne({ where: { gtp_location_id: createGtpDto.gtp_location_id} });
    if (existingGtp) {
      throw new BadRequestException(`GTP location for id ${createGtpDto.gtp_location_id} already exists`);
    }
    const newGtp = this.gtpRepository.create(createGtpDto);
    return await this.gtpRepository.save(newGtp);
  }

  findAll() {
    return this.gtpRepository.find({
      relations: ['station'], // Assuming GTP has a relation with Station
    });
    // return `This action returns all gtp`;
  }

  async findOne(id: string) {
    const existing = await  this.gtpRepository.findOne({where: { gtp_location_id: id}});
    if (!existing){
      throw new NotFoundException(`GTP with id ${id} not found`);
    }
    return existing;
  }

  async update(id: string, updateGtpDto: GtpLocation) {
    const existing = await this.gtpRepository.findOne({ where: { gtp_location_id: id } });
    if (!existing) {
      throw new NotFoundException(`GTP with id ${id} not found`);
    }
    // Check if this GTP location is assigned to any order items in IN_PROGRESS state
    const inProgressOrderItems = await this.orderItemRepository.find({
      where: { 
        assigned_gtp_location: id,
        status: OrderItemStatus.IN_PROGRESS
      }
    });
    
    if (inProgressOrderItems.length > 0) {
      const orderIds = inProgressOrderItems.map(item => item.order_id).join(', ');
      throw new ForbiddenException(`Cannot update GTP location ${id}: A license plate number is assigned to this location.`);
    }
    if (updateGtpDto.station_id) {
      const station = await this.stationRepository.findOne({ where: { station_id: updateGtpDto.station_id } });
      if (!station) {
        throw new NotFoundException(`Station with id ${updateGtpDto.station_id} not found`);
      }
      const existingGtp = await this.gtpRepository.findOne({ where: { gtp_location_id: updateGtpDto.gtp_location_id } });
      if (existingGtp && existingGtp.gtp_location_id !== id) {
        throw new BadRequestException(`GTP location with id ${updateGtpDto.gtp_location_id} already exists`);
      }
    }
    await this.gtpRepository.update(id, updateGtpDto);
    if (updateGtpDto.station_id) {
      id = updateGtpDto.gtp_location_id; // Use the updated gtp_location_id if provided
    }
    return await this.gtpRepository.findOne({where: { gtp_location_id: updateGtpDto.gtp_location_id}});
  }
  async remove(id: string) {
    const existing = await this.gtpRepository.findOne({ where: { gtp_location_id: id } });
    if (!existing) {
      throw new NotFoundException(`GTP with id ${id} not found`);
    }
    const exisingOrder = await this.orderItemRepository.findOne({
      where: { assigned_gtp_location: id }
    });
    if (exisingOrder) {
      throw new ForbiddenException(`Cannot delete GTP location ${id}: A license plate number was assigned to this location.`);
    }
    // Check if this GTP location is assigned to any order items in IN_PROGRESS state
    const inProgressOrderItems = await this.orderItemRepository.find({
      where: { 
        assigned_gtp_location: id,
        status: OrderItemStatus.IN_PROGRESS
      }
    });
    
    if (inProgressOrderItems.length > 0) {
      const orderIds = inProgressOrderItems.map(item => item.order_id).join(', ');
      throw new ForbiddenException(`Cannot delete GTP location ${id}: A license plate number is assigned to this location.`);
    }
    
    return this.gtpRepository.delete(id).then(() => {
      return { message: `GTP with id ${id} has been removed` };
    });
    // return `This action removes a #${id} gtp`;
  }
}
