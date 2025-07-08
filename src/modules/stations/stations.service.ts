import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { CreateStationDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/update-station.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Station } from 'src/entities/station.entity';
import { GtpLocation, OrderItem, OrderItemStatus } from 'src/entities';
import { ProductRequirement as ProductRequirementEntity } from 'src/entities/product-requirement.entity';

@Injectable()
export class StationsService {
  constructor(
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    @InjectRepository(GtpLocation)
    private readonly gtpLocation: Repository<GtpLocation>, // Assuming GtpLocation is an entity
    @InjectRepository(ProductRequirementEntity)
    private readonly productRequirementRepository: Repository<ProductRequirementEntity>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
  ) {}

  async create(createStationDto: CreateStationDto) {
    const existing = await this.stationRepository.findOne({
      where: { station_id: createStationDto.station_id },
    });
    if (existing) {
      throw new BadRequestException(`Station with id ${createStationDto.station_id} already exists`);
    }
    const newStation = this.stationRepository.create(createStationDto);
    const saved = await this.stationRepository.save(newStation);
    for (const gtp_location_id of createStationDto.gtp_locations_array || []) {
      const gtpLocation = await this.gtpLocation.findOne({ where: { gtp_location_id } });
      if (gtpLocation){
        gtpLocation.station_id = newStation.station_id; // Set the station_id in GtpLocation
        await this.gtpLocation.save(gtpLocation); // Save the updated GtpLocation
      }
    }
    return saved;
    
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
    const existing = await this.stationRepository.findOne({
      where: { station_id: id },
      relations: ['gtpLocations'],
    });
    console.log('Existing Station:', existing);
    if (!existing) {
      throw new NotFoundException(`Station with id ${id} not found`);
    }

    // Check if any GTP locations being removed are assigned to IN_PROGRESS order items
    const removedGtpLocationIds = existing.gtpLocations
      ?.filter(loc => !(updateStationDto.gtp_locations_array || []).includes(loc.gtp_location_id))
      .map(loc => loc.gtp_location_id) || [];

    for (const gtpLocationId of removedGtpLocationIds) {
      // Check if this GTP location is assigned to any IN_PROGRESS order items
      const inProgressOrderItems = await this.orderItemRepository.find({
        where: { 
          assigned_gtp_location: gtpLocationId,
          status: OrderItemStatus.IN_PROGRESS // Using the enum value instead of string literal
        }
      });
      
      if (inProgressOrderItems.length > 0) {
        throw new ForbiddenException(`Cannot remove GTP location ${gtpLocationId}: It is assigned to order items with IN_PROGRESS status.`);
      }
    }
    // Remove GtpLocations that are no longer associated
    const existingGtpLocationIds = existing.gtpLocations?.map(loc => loc.gtp_location_id) || [];
    const updatedGtpLocationIds = updateStationDto.gtp_locations_array || [];

    console.log('Existing GTP Location IDs:', existingGtpLocationIds);
    console.log('Updated GTP Location IDs:', updatedGtpLocationIds);
    // Remove associations for GtpLocations not in the update DTO
    for (const gtpLocationId of existingGtpLocationIds) {
      if (!updatedGtpLocationIds.includes(gtpLocationId)) {
        const gtpLocation = await this.gtpLocation.findOne({ where: { gtp_location_id: gtpLocationId } });
        if (gtpLocation) {
          gtpLocation.station_id = undefined;
          await this.gtpLocation.save(gtpLocation);
          existing.gtpLocations = existing.gtpLocations.filter(loc => loc.gtp_location_id !== gtpLocationId);
        }
      }
    }
    await this.stationRepository.save(existing); // Save the updated Station to clear gtpLocations
    console.log('Updated GTP Location IDs:', updatedGtpLocationIds);
    // Add or update associations for new GtpLocations
    for (const gtpLocationId of updatedGtpLocationIds) {
      const gtpLocation = await this.gtpLocation.findOne({ where: { gtp_location_id: gtpLocationId } });
      if (gtpLocation && gtpLocation.station_id !== id) {
        gtpLocation.station_id = id;
        await this.gtpLocation.save(gtpLocation);
      }
      else if (!gtpLocation){
        if (updateStationDto.gtp_locations_array)
          updateStationDto.gtp_locations_array = updateStationDto.gtp_locations_array.filter(loc => loc !== gtpLocationId);
      }
    }
    console.log('Updated GTP Location IDs 2:', updatedGtpLocationIds);
    delete updateStationDto.gtp_locations_array;
    await this.stationRepository.update(id, updateStationDto);


    console.log("completed update");

    return await  this.stationRepository.findOne({
      where: { station_id: id },
      relations: ['gtpLocations'],
    });
  }

  async remove(id: string) {
    const existing = await this.stationRepository.findOne({ where: { station_id: id } });
    if (!existing) {
      throw new NotFoundException(`Station with id ${id} not found`);
    }
    
    // Check if this station exists in product_requirement table
    const productRequirements = await this.productRequirementRepository.find({
      where: { station_id: id }
    });
    
    if (productRequirements.length > 0) {
      const productIds = productRequirements.map(pr => pr.product_id).join(', ');
      throw new ForbiddenException(`Cannot delete station ${id}: Products are scheduled to reach this station. Products: ${productIds}.`);
    }
    
    for (const gtpLocationarray in existing.gtpLocations) {
      const gtpLocation = await this.gtpLocation.findOne({ where: { gtp_location_id: gtpLocationarray } });
      if (gtpLocation) {
        gtpLocation.station_id = ''; // Clear the station_id in GtpLocation
        await this.gtpLocation.save(gtpLocation); // Save the updated GtpLocation
      }
    }
    existing.gtpLocations = [];
    await this.stationRepository.save(existing); // Save the updated Station to clear gtpLocations
    return this.stationRepository.delete(id).then(() => {
      return { message: `Station with id ${id} has been removed` };
    });
  }
}
