import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import { Product } from 'src/entities/product.entity';
import { UploadInventoryResponseDto } from './dto/upload-inventory-response.dto';
import { ProductRequirement } from 'src/entities/product-requirement.entity';
import { toBuffer } from 'bwip-js';
import { LocationStatus } from 'src/entities/station.entity';
import { firstValueFrom } from 'rxjs';
import { Task, TaskStatus } from 'src/entities';
import { MOVE_TYPE } from 'src/entities/task.entity';

@Injectable()
export class InventoryService {
  httpService: any;
  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductRequirement)
    private readonly productRequirementRepository: Repository<ProductRequirement>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
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

  async update(id: string, updateInventoryDto: Inventory) {
    const existingInventory = await this.inventoryRepository.findOne({ where: { id } });
    
    if (!existingInventory) {
      throw new NotFoundException(`Inventory with id ${id} not found`);
    }
    
    if (existingInventory.isProcessing){
      throw new BadRequestException(`Cannot update inventory ${id} while it is being processed`);
    }

    await this.inventoryRepository.update(id, updateInventoryDto);
    if (updateInventoryDto.id) {
      id = updateInventoryDto.id;
    }

    return await this.inventoryRepository.findOne({ 
      where: { id: id },
      relations: ['product']
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
    try{
      const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
      const warehosue_key = process.env.WMS_WAREHOUSE_AUTH_kEY || 'test';
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
    }catch{
      throw new BadRequestException('Failed to fetch WMS inventory locations');
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
            .where("id = :id AND status = :status", {
                id: id,
                status: LocationStatus.AVAILABLE
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
}
