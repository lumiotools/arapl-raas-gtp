import { Injectable, BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { CreateStationDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/update-station.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { LocationStatus, Station } from 'src/entities/station.entity';
import { GtpLocation, OrderItem, OrderItemStatus, Task } from 'src/entities';
import { ProductRequirement as ProductRequirementEntity } from 'src/entities/product-requirement.entity';
import { MOVE_TYPE, TaskStatus, TaskType } from 'src/entities/task.entity';
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
      const warehosue_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
      const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';
      console.log(`Fetching WMS locations from ${wms_base_url}`);
      const response = await fetch(`${wms_base_url}/robot-job/${warehouse_name}/locations?location_zone=station&location_type=station`, {
        method: 'GET',
        headers: {
          'authorization': `${warehosue_key}`,
          'Content-Type': 'application/json'
        }
      });
      const data: {zone_id:string, available_location_types: any[]} = await response.json();
      // console.log(`Response from WMS: ${JSON.stringify(data)}`);
      return data;
    }
    catch{
      throw new BadRequestException('Failed to fetch WMS stations');
    }
    
  }

  async findAll() {
    try{
      const station_object = (await this.getAllWmsStations());
      const station_bin_locations = station_object.available_location_types || [];
      const bin_ids = station_bin_locations.map((bin: any) => bin.location_id);
      const allStations = await this.stationRepository.find();

      // find bin_ids that are not in allStations
      const missingBinIds = bin_ids.filter(id => !allStations.some(station => station.station_id === id));
      // Sort missing binIds by extracting numeric part and sorting numerically
      missingBinIds.sort((a, b) => {
        const aNum = parseInt(a.replace(/\D/g, ''), 10);
        const bNum = parseInt(b.replace(/\D/g, ''), 10);
        return aNum - bNum;
      });
      for (let i = 0; i < missingBinIds.length; i++) {
        const missingId = missingBinIds[i];
        await this.create({
          station_id: missingId,
          station_name: missingId,
          priority: i + 1,
        });
      }

      // find allStations ids that are not in bin_ids
      const existingStationIds = allStations.map(station => station.station_id);
      const missingStationIds = existingStationIds.filter(id => !bin_ids.includes(id));
      if (missingStationIds.length > 0) {
        // await this.stationRepository.delete(missingStationIds);
        for (const id of missingStationIds) {
          // await this.remove(id);
          await this.stationRepository.update(
            { station_id: id },
            { is_active:false }
          );
        }
      }
      // find intersecting location IDs
      // const intersectingLocationIds = bin_ids.filter(id => existingStationIds.includes(id));
      // for (const id of intersectingLocationIds) {
      //   const station = allStations.filter(station => station.station_id === id)[0];
      //   if (station.is_active === false) {
      //     await this.stationRepository.update(
      //       { station_id: id },
      //       { is_active: true }
      //     );
      //   }
      // }
      return await this.stationRepository.find({ relations: ['gtpLocations'] });
    }catch{
      throw new BadRequestException('Failed to fetch WMS stations');
    }
  }

  async findOne(id: string) {
    try{
      return this.stationRepository.findOne({ where: { station_id: id }, relations: ['gtpLocations'] });
      const station_object = await this.getAllWmsStations();
      const bin_locations = station_object.available_location_types || [];
      const binLocation = bin_locations.find((bin: any) => bin.location_id === id);
      if (!binLocation) {
        const existing = await this.stationRepository.findOne({ where: { station_id: id } });
        if (existing) {
          // this.stationRepository.delete({ station_id: id });
          // await this.remove(id);
          await this.stationRepository.update(
            { station_id: id },
            { is_active:false }
          )
          return existing;
        }
        throw new NotFoundException(`Station with id ${id} not found in WMS bin locations`);
      }
      
      let station = await this.stationRepository.findOne({
        where: { station_id: id },
        relations: ['gtpLocations']
      });
      if (station?.is_active==false){
        await this.stationRepository.update(
          { station_id: id },
          { is_active:true }
        );
      }
      if (!station) {
        station = await this.create({
          station_id: id,
          station_name: id,
          priority: 1,
        });
      }
      return station;
    }catch{
      throw new BadRequestException(`Failed to fetch WMS station with id ${id}`);
    }
    
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
        // Single atomic operation: Update only if status is AVAILABLE
        const result = await queryRunner.manager
            .createQueryBuilder()
            .update(Station)
            .set({ status: LocationStatus.RESERVED })
            .where("station_id = :station_id AND status = :status AND is_active = :is_active", {
                station_id: station_id,
                status: LocationStatus.AVAILABLE,
                is_active: true
            })
            .execute();

        // If no rows were affected, station was either not found or not available
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

  async getActiveRobotAtStation(station_id: string): Promise<any | null> {
    const tasks = await this.taskRepository.find({
      where: { status: In([TaskStatus.COMPLETED, TaskStatus.PROCESSING, TaskStatus.INQUEUE]) }
    });
    let robot_id : string | null = null;
    let robot_task : Task | null = null;
    for (const task of tasks){
      if (task.end_location.location_attribute.attribute_value=='station' && task.end_location.location_id==station_id){
        robot_id = task.robot_id;
        robot_task = task;
        break;
      }
    }
    const station = await this.stationRepository.findOne({
      where: { station_id },
      relations: ['gtpLocations']
    });
    if (!station) {
      throw new BadRequestException("Station not found")
    }
    let required_quantity = 0;
    for (const gtpLocation of station?.gtpLocations || []) {
      console.log(`Checking GTP Location: ${gtpLocation.gtp_location_id}`);
      if (gtpLocation) {
        const inProgressOrderItems = await this.orderItemRepository.find({
          where: { 
            assigned_gtp_location: gtpLocation.gtp_location_id,
            status: OrderItemStatus.IN_PROGRESS,
            product_id: robot_task?.product_id || ''
          }
        });
        required_quantity += inProgressOrderItems.reduce((sum, item) => sum + item.remaining_quantity, 0);
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
      drop_quantity: Math.min(required_quantity, robot_task?.quantity || 0),
      status: status
    }
  }

  async getUnloadingTimes(startDate: Date | undefined, endDate: Date | undefined, module: "FlowOps" | "BaseOps" = "FlowOps"): Promise<any> {
    const allStations = await this.stationRepository.find();
    const whereCondition: any = {
      task_type: module === "FlowOps" ? TaskType.GOODS_TO_PERSON : TaskType.BASEOPS
    };
    if (startDate && endDate) {
      whereCondition.created_at = Between(startDate, endDate);
    }
    else if (startDate){
      whereCondition.created_at = MoreThanOrEqual(startDate);
    }
    else if (endDate){
      whereCondition.created_at = LessThan(endDate);
    }
    const allTasks = await this.taskRepository.find({
      where: whereCondition,
    });
    console.log(`where condition: ${JSON.stringify(whereCondition)}`)
    const result = {};
    for (const task of allTasks) {
      if (!task.triggered || !task.completed) continue;
      let end_location: string;
      end_location = task.end_location.location_id;
      if (end_location) {
        const station = allStations.find(station => station.station_id === end_location);
        if (station) {
          let unloading_time = Math.floor((Number(task.triggered) - Number(task.completed)) / 1000);
          if (result[station.station_id]) {
            result[station.station_id].unloading_time.push(unloading_time);
            result[station.station_id].task_count += 1;
          } else {
            result[station.station_id] = {
              unloading_time: [unloading_time],
              task_count: 1
            };
          }
        }
      }
    }
    return result;
  }
}
