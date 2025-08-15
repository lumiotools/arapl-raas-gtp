import { Injectable, BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { CreateStationDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/update-station.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LocationStatus, Station } from 'src/entities/station.entity';
import { GtpLocation, OrderItem, OrderItemStatus, Task } from 'src/entities';
import { ProductRequirement as ProductRequirementEntity } from 'src/entities/product-requirement.entity';
import { MOVE_TYPE, TaskStatus } from 'src/entities/task.entity';
import { firstValueFrom } from 'rxjs';
import { ConflictError } from 'groq-sdk';

@Injectable()
export class StationsService {
  httpService: any;
  constructor(
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    @InjectRepository(GtpLocation)
    private readonly gtpLocation: Repository<GtpLocation>, // Assuming GtpLocation is an entity
    @InjectRepository(ProductRequirementEntity)
    private readonly productRequirementRepository: Repository<ProductRequirementEntity>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
  ) {}

  async create(createStationDto: CreateStationDto) {
    // throw new ConflictException('Station Creation is not allowed.');
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

  async getAllWmsStations(){
    try{
      const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
      const warehosue_key = process.env.WMS_WAREHOUSE_AUTH_kEY || 'test';
      const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';
      console.log(`Fetching WMS locations from ${wms_base_url}`);
      const response = await fetch(`${wms_base_url}/robot-job/${warehouse_name}/locations?location_status=empty&location_zone=station&location_type=station`, {
        method: 'GET',
        headers: {
          'authorization': `${warehosue_key}`,
          'Content-Type': 'application/json'
        }
      });
      const data: {zone_id:string, available_locations: any[]} = await response.json();
      console.log(`Response from WMS: ${JSON.stringify(data)}`);
      if (data) {
        return data;
      }
      return {
        zone_id: "station",
        available_locations:[]
      };
    }
    catch{
      return {
        zone_id: "station",
        available_locations:[]
      };
    }
    
  }

  async findAll() {
    const station_object = (await this.getAllWmsStations());
    console.log(`station_object: ${JSON.stringify(station_object)}`)
    const station_bin_locations = station_object.available_locations || [];
    const bin_ids = station_bin_locations.map(bin => bin.location_id);
    const allStations = await this.stationRepository.find();

    // find bin_ids that are not in allStations
    const missingBinIds = bin_ids.filter(id => !allStations.some(station => station.station_id === id));
    for (const missingId of missingBinIds) {
      // const newStation = this.stationRepository.create({
      //   station_id: missingId,
      //   station_name: station_bin_locations.find(bin => bin.id === missingId)?.name || 'Unknown',
      //   gtpLocations: [],
      //   priority:1,
      // });
      const newStation = await this.create({
        station_id: missingId,
        station_name: missingId,
        priority:1,
      });
    }

    // find allStations ids that are not in bin_ids
    const existingStationIds = allStations.map(station => station.station_id);
    const missingStationIds = existingStationIds.filter(id => !bin_ids.includes(id));
    if (missingStationIds.length > 0) {
      // await this.stationRepository.delete(missingStationIds);
      for (const id of missingStationIds) {
        this.remove(id);
      }
    }
    return await this.stationRepository.find({ relations: ['gtpLocations'] });
  }

  async findOne(id: string) {
    const station_object = await this.getAllWmsStations()[0];
    const bin_locations = station_object.available_locations || [];
    const binLocation = bin_locations.find((bin: { location_id: string }) => bin.location_id === id);
    if (!binLocation) {
      const existing = await this.stationRepository.findOne({ where: { station_id: id } });
      if (existing) {
        // this.stationRepository.delete({ station_id: id });
        this.remove(id);
      }
      throw new NotFoundException(`Station with id ${id} not found in WMS bin locations`);
    }
    const bin_name = binLocation.name;
    let station = await this.stationRepository.findOne({
      where: { station_id: id },
      relations: ['gtpLocations']
    });
    if (!station) {
      station = await this.create({
        station_id: id,
        station_name: bin_name,
        priority: 1,
      });
      station = await this.stationRepository.save(station);
    }
    return station;
  }

  async update(id: string, updateStationDto: UpdateStationDto) {
    if (id!=updateStationDto.station_id){
      throw new ConflictException('Station ID mismatch');
    }
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
    // throw new ConflictException('Station Removal is not allowed.');
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

  async isStationCancelled(station_id: string): Promise<boolean> {
    const productRequirements = await this.productRequirementRepository.find({
      where: { station_id, isCancelled: true }
    });
    return productRequirements.length > 0;
  }

  async getCancelledStations(): Promise<string[]> {
    const cancelledRequirements = await this.productRequirementRepository.find({
      where: { isCancelled: true }
    });
    const cancelledStationIds = new Set(cancelledRequirements.map(req => req.station_id))
    return Array.from(cancelledStationIds);
  }

  async removeProductRequirment(station_id: string): Promise<void> {
    const productRequirements = await this.productRequirementRepository.find({
      where: { station_id }
    });
    if (productRequirements.length === 0) {
      throw new NotFoundException(`No product requirements found for station ${station_id}`);
    }
    
    await this.productRequirementRepository.remove(productRequirements);
  }

  async reserveStation(station_id: string): Promise<boolean> {
    const queryRunner = this.stationRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const station = await queryRunner.manager.findOne(Station, { where: { station_id: station_id } });

      if (!station) {
        return false;
      }

      if (station.status !== LocationStatus.AVAILABLE) {
        return false;
      }

      station.status = LocationStatus.RESERVED;
      await queryRunner.manager.save(Station, station);

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

  async getActiveRobotAtStation(station_id: string): Promise<any | null> {
    const station = await this.stationRepository.findOne({
      where: { station_id }
    });
    const tasks = await this.taskRepository.find({
      where: { status: In([TaskStatus.COMPLETED, TaskStatus.PROCESSING]) }
    });
    let robot_id : string | null = null;
    let robot_task : Task | null = null;
    for (const task of tasks){
      if (task.end_location.location_attribute.attribute_value=='station' && task.end_location.location_id==station_id){
        robot_id = task.robot_id;
        robot_task = task;
      }
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
      product_id: robot_task?.product_id || null,
      quantity: robot_task?.quantity || null,
      source: robot_task?.start_location.location_id || null,
      status: status
    }
  }
}
