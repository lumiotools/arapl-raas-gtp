import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import { Product } from 'src/entities/product.entity';
import { UploadInventoryResponseDto } from './dto/upload-inventory-response.dto';
import { ProductRequirement } from 'src/entities/product-requirement.entity';
import { toBuffer } from 'bwip-js';
import { LocationStatus } from 'src/entities/station.entity';
import { firstValueFrom } from 'rxjs';
import { Task, TaskStatus } from 'src/entities';
import { MOVE_TYPE } from 'src/entities/task.entity';
import { EmptyLocation } from 'src/entities/empty-location.entity';

@Injectable()
export class InventoryService {
  httpService: any;
  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(EmptyLocation)
    private readonly emptyLocationRepository: Repository<EmptyLocation>,
  ) {}

  async create(createInventoryDto: Inventory) {
    // Check if inventory already exists for this location
    const existingInventory = await this.inventoryRepository.findOne({ 
      where: { id: createInventoryDto.id } 
    });
    
    if (existingInventory) {
      throw new BadRequestException(`Inventory with id ${createInventoryDto.id} already exists`);
    }
    const newInventory = this.inventoryRepository.create(createInventoryDto);
    return await this.inventoryRepository.save(newInventory);
  }

  // Helper method for CSV upload - creates inventory without strict product validation
  private async createInventoryForUpload(createInventoryDto: Inventory) {
    // Check if inventory already exists for this location
    const existingInventory = await this.inventoryRepository.findOne({ 
      where: { id: createInventoryDto.id } 
    });
    
    if (existingInventory) {
      throw new BadRequestException(`Inventory with id ${createInventoryDto.id} already exists`);
    }
    // if (createInventoryDto.barcode_number){
    //   try {
    //     const barcodeBuffer = await toBuffer({
    //       bcid: 'code128', // Barcode type
    //       text: createInventoryDto.barcode_number, // Barcode number
    //       scale: 3,
    //       height: 10,
    //       includetext: true,
    //       textxalign: 'center',
    //     });
    //     createInventoryDto.barcode_image = barcodeBuffer;
    //   } catch (err) {
    //     throw new BadRequestException(`Failed to generate barcode image: ${err.message}`);
    //   }
    // }

    const newInventory = this.inventoryRepository.create(createInventoryDto);
    return await this.inventoryRepository.save(newInventory);
  }

  async findAll() {
    const inventories: any[] = await this.inventoryRepository.find();
    for (let i = 0; i < inventories.length; i++) {
      const inv = inventories[i];
      // Initialize is_at_empty_location to false by default
      inventories[i].is_at_empty_location = false;
      inventories[i].empty_location_id = null;
      inventories[i].pallet_id = null;
      
      if (inv.isProcessing) {
        const recentTask = await this.taskRepository.findOne({
          where: { origin_location: inv.id },
          order: { created_at: 'DESC' }
        });
        if (recentTask && (recentTask.move_type === MOVE_TYPE.STATION_TO_EMPTY_LOCATION
          || recentTask.move_type === MOVE_TYPE.WAITING_LOCATION_TO_EMPTY_LOCATION)
        ) {
          inventories[i].is_at_empty_location = inventories[i].is_empty;
          inventories[i].empty_location_id = recentTask.end_location.location_id;
          inventories[i].pallet_id = recentTask.cargos ? recentTask?.cargos[0]?.cargo_code : null;
        }
      }
    }
    // console.log(`inventories: ${JSON.stringify(inventories)}`);
    return inventories;
    try{
      const inventory_object = await this.getAllInventoryLocations();
      const bin_locations = inventory_object.available_location_types || [];
      const bin_ids = bin_locations.map(bin => bin.location_id);

      let inventories = await this.inventoryRepository.find({
        relations: ['product']
      });

      const inventory_ids = inventories.map(inv => inv.id);

      // find ids present in inventory_ids but not present in bin_ids
      const missingBinIds = inventory_ids.filter(id => !bin_ids.includes(id));
      // if (missingBinIds.length > 0) {
      //   await this.inventoryRepository.delete(missingBinIds); // remove missing inventory ids
      // }

      // find ids that exists in inventory ids and bin_ids
      const existingBinIds = inventory_ids.filter(id => bin_ids.includes(id));
      inventories = inventories.filter(inv => existingBinIds.includes(inv.id));

      // Calculate priorities for all inventories
      // const inventoriesWithPriority = await this.addPriorityToInventories(inventories);
      return inventories;
    }catch(err){
      throw new BadRequestException(`Failed to fetch inventory locations: ${err.message}`);
    }
  }

  // private async addPriorityToInventories(inventories: Inventory[]) {
  //   // Get all product requirements to calculate total demand per product
  //   const productRequirements = await this.productRequirementRepository.find();
    
  //   // Calculate total requirement per product
  //   const productDemandMap = new Map<string, number>();
  //   for (const req of productRequirements) {
  //     const currentDemand = productDemandMap.get(req.product_id) || 0;
  //     productDemandMap.set(req.product_id, currentDemand + req.requirement);
  //   }

  //   // Get max demand to normalize priorities (0-100 scale)
  //   const maxDemand = Math.max(...Array.from(productDemandMap.values()), 1);

  //   // Add priority to each inventory item
  //   return inventories.map(inventory => ({
  //     ...inventory,
  //     priority: this.calculatePriority(inventory.product_id, productDemandMap, maxDemand)
  //   }));
  // }

  private calculatePriority(productId: string, demandMap: Map<string, number>, maxDemand: number): number {
    const demand = demandMap.get(productId) || 0;
    
    // Normalize to 0-100 scale (higher demand = higher priority)
    const priority = Math.round((demand / maxDemand) * 100);
    return priority;
  }

  async findOne(id: string) {
    return this.inventoryRepository.findOne({ where: { id } });
    try{
      const inventory_object = await this.getAllInventoryLocations();
      const bin_locations = inventory_object.available_location_types || [];
      const binLocation = bin_locations.find((bin: { location_id: string }) => bin.location_id === id);
      if (!binLocation) {
        const existing = await this.inventoryRepository.findOne({ where: { id } });
        // if (existing) {
        //   this.inventoryRepository.delete({ id });
        // }
        throw new NotFoundException(`Inventory with id ${id} not found in WMS bin locations`);
      }
      let inventory = await this.inventoryRepository.findOne({
        where: { id: id },
      });
      console.log(`inventory: ${JSON.stringify(inventory)}`)
      return inventory;
    }catch{
      throw new BadRequestException('Failed to fetch inventory');
    }
  }

  async update(id: string, updateInventoryDto: any) {
    const existingInventory = await this.inventoryRepository.findOne({ where: { id } });
    
    if (!existingInventory) {
      throw new NotFoundException(`Inventory with id ${id} not found`);
    }

    await this.inventoryRepository.update(id, updateInventoryDto);
    if (updateInventoryDto.id) {
      id = updateInventoryDto.id;
    }

    return await this.inventoryRepository.findOne({ 
      where: { id: id },
    });
  }

  async remove(id: string) {
    const existingInventory = await this.inventoryRepository.findOne({ where: { id } });
    
    if (!existingInventory) {
      throw new NotFoundException(`Inventory with id ${id} not found`);
    }
    
    await this.inventoryRepository.delete(id);
    return { message: `Inventory with id ${id} has been removed` };
  }

  async getAllInventoryLocations(){
    const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
    const warehosue_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
    const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';
    const response = await fetch(`${wms_base_url}/robot-job/${warehouse_name}/locations?location_zone=inventory&location_type=inventory`, {
      method: 'GET',
      headers: {
        'authorization': `${warehosue_key}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    return data;
  }


  async processInventoryFile(file: Express.Multer.File): Promise<UploadInventoryResponseDto> {
    try {
      const csvData = file.buffer.toString('utf8');
      const lines = csvData.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) {
        throw new BadRequestException('CSV file is empty');
      }

      // Parse header
      const headers = lines[0].split(',').map(h => h.trim());
      const expectedHeaders = ['Inv Locations','barcode_number'];
      
      // Validate headers
      if (!expectedHeaders.every(header => headers.includes(header))) {
        throw new BadRequestException(`Invalid CSV format. Expected headers: ${expectedHeaders.join(', ')}`);
      }

      const results = {
        successful: 0,
        failed: 0,
        errors: [] as string[]
      };
      const inventory_object = await this.getAllInventoryLocations();
      const bin_locations = inventory_object.available_location_types || [];
      const customer_location_ids = bin_locations.map(bin => bin.customer_location_id);
      console.log(`customer_location_ids: ${JSON.stringify(customer_location_ids)}`);
      // Process each row (skip header)
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        
        if (values.length < 2) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Invalid number of columns`);
          continue;
        }

        const invLocation = values[0]; // Inv Locations
        const barcodeNumber = values[1]; // Barcode number

        if (!invLocation || !barcodeNumber) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Missing required fields (Inv Locations or Barcode Number)`);
          continue;
        }

        try {
          if (customer_location_ids.includes(invLocation) === false) {continue;}
          // Check if inventory exists
          // Try to update existing inventory first
          const existingInventory = await this.inventoryRepository.findOne({ 
            where: { location_name: invLocation } 
          });

          console.log(`existingInventory: ${JSON.stringify(existingInventory)}`);
          console.log(`invLocation: ${invLocation}, barcodeNumber: ${barcodeNumber}`);
          console.log(`${bin_locations.filter(bin => bin.customer_location_id === invLocation)[0]}`);

          if (existingInventory) {
            // Update existing inventory
            const inventoryData = {
              id: bin_locations.filter(bin => bin.customer_location_id === invLocation)[0].location_id,
              location_name: bin_locations.filter(bin => bin.customer_location_id === invLocation)[0].customer_location_id,
              barcode_number: barcodeNumber,
            } as Inventory;

            await this.update(invLocation, inventoryData);
            results.successful++;
          } else {
            // Create new inventory entry if it doesn't exist
            const inventoryData = {
              id:  bin_locations.filter(bin => bin.customer_location_id === invLocation)[0].location_id,
              location_name: bin_locations.filter(bin => bin.customer_location_id === invLocation)[0].customer_location_id,
              barcode_number: barcodeNumber,
            } as Inventory;

            console.log(`Creating inventory: ${JSON.stringify(inventoryData)}`);

            await this.createInventoryForUpload(inventoryData);
            results.successful++;
          }
        } catch (error) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: ${error.message}`);
        }
      }

      return {
        message: `Processed ${results.successful + results.failed} rows`,
        successful: results.successful,
        failed: results.failed,
        errors: results.errors
      };

    } catch (error) {
      throw new BadRequestException(`Failed to process CSV file: ${error.message}`);
    }
  }


  async reserveInventory(id: string): Promise<boolean> {
    const queryRunner = this.inventoryRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
        // Single atomic operation: Update only if status is AVAILABLE
        const result = await queryRunner.manager
            .createQueryBuilder()
            .update(Inventory)
            .set({ status: LocationStatus.RESERVED })
            .where("id = :id AND status = :status AND is_active = :is_active", {
                id: id,
                status: LocationStatus.AVAILABLE,
                is_active: true
            })
            .execute();

        // If no rows were affected, inventory was either not found or not available
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

  async getActiveRobotAtInventory(inventoryId: string) {
    const inventory = await this.inventoryRepository.findOne({
      where: { id: inventoryId },
    });
    if (!inventory){
      throw new BadRequestException("Inventory not found");
    }
    if (inventory.holded_by === null){
      return {robot_id: null}
    }
    const task = await this.taskRepository.findOne({
      where: { task_id: inventory.holded_by },
    });
    return {
      robot_id: task?.robot_id || null,
      source: task?.start_location.location_id || null,
      status: "HOLDED"
    }
  }

  async setInventoryAvailable(inventoryId: string): Promise<void> {
    const inventory = await this.inventoryRepository.findOne({
      where: { id: inventoryId },
    });
    if (!inventory){
      throw new BadRequestException("Inventory not found");
    }
    inventory.status = LocationStatus.AVAILABLE;
    inventory.isProcessing = false;
    inventory.holded_by = null;
    inventory.is_active = true;
    inventory.is_empty = false;
    await this.inventoryRepository.save(inventory);
  }

  async setInventoryUnavailable(inventoryId: string): Promise<void> {
    const inventory = await this.inventoryRepository.findOne({
      where: { id: inventoryId },
    });
    if (!inventory){
      throw new BadRequestException("Inventory not found");
    }
    inventory.status = LocationStatus.AVAILABLE;
    inventory.isProcessing = false;
    inventory.holded_by = null;
    inventory.is_active = false;
    inventory.is_empty = false;
    await this.inventoryRepository.save(inventory);
  }

  async removeInventoryFromEmpty(inventoryId: string): Promise<void> {
    const inventory = await this.inventoryRepository.findOne({
      where: { id: inventoryId },
    });
    if (!inventory){
      throw new BadRequestException("Inventory not found");
    }
    inventory.is_empty = false;
    await this.inventoryRepository.save(inventory);
  }

  async occupyQuarantine(id: string, barcode_number: string) {
    const existingInventory = await this.inventoryRepository.findOne({ where: { id } });
    if (!existingInventory) {
      throw new NotFoundException(`Inventory with ID ${id} not found`);
    }
    existingInventory.is_active = true;
    existingInventory.is_empty = false;
    existingInventory.barcode_number = barcode_number;
    existingInventory.status = LocationStatus.OCCUPIED;
    existingInventory.is_quarantine = true;
    existingInventory.isProcessing = true;
    await this.inventoryRepository.save(existingInventory);
  }

  async makeInventoryProcessing(id: string) {
    const existingInventory = await this.inventoryRepository.findOne({ where: { id: id } });
    if (!existingInventory) {
      throw new NotFoundException(`Inventory with ID ${id} not found`);
    }
    existingInventory.isProcessing = true;
    existingInventory.is_active = true;
    await this.inventoryRepository.save(existingInventory);
  }

  async makeInventoryUnavailable(id: string) {
    const existingInventory = await this.inventoryRepository.findOne({ where: { id } });
    if (!existingInventory) {
      throw new NotFoundException(`Inventory with ID ${id} not found`);
    }
    existingInventory.is_active = false;
    existingInventory.is_empty = false;
    await this.inventoryRepository.save(existingInventory);
  }

  async makeInventoryAvailable(id: string) {
    const existingInventory = await this.inventoryRepository.findOne({ where: { id } });
    if (!existingInventory) {
      throw new NotFoundException(`Inventory with ID ${id} not found`);
    }
    existingInventory.is_active = true;
    existingInventory.is_empty = false;
    existingInventory.isProcessing = false;
    existingInventory.status = LocationStatus.AVAILABLE;
    await this.inventoryRepository.save(existingInventory);
  }
}
