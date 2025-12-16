import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Inventory, OrderItem, Product, Station, GtpLocation, WaitingLocation, Task, TaskStatus, OrderItemStatus, TaskType } from "src/entities";
import { Between, Repository } from "typeorm";
import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { EmptyLocation } from "src/entities/empty-location.entity";
import { EmptyLocationsService } from "../empty_locations/empty_locations.service";
import { SettingsService } from "../settings/settings.service";
import { Settings } from "src/entities/settings.entity";

enum ContextParams {
    ORDER_ITEMS = 'order_items',
    GTP_LOCATIONS = 'gtp_locations',
    STATIONS = 'stations',
    EMPTY_LOCATIONS = 'empty_locations',
    INVENTORY_LOCATIONS = 'inventory_locations',
    SETTINGS = 'settings'
}

@Injectable()
export class ToolService {
    constructor(
        @InjectRepository(Inventory)
        private readonly inventoryRepository: Repository<Inventory>,
        @InjectRepository(Product)
        private readonly productRepository: Repository<Product>,
        @InjectRepository(OrderItem)
        private readonly orderItemRepository: Repository<OrderItem>,
        @InjectRepository(Station)
        private readonly stationRepository: Repository<Station>,
        @InjectRepository(GtpLocation)
        private readonly gtpLocationRepository: Repository<GtpLocation>,
        @InjectRepository(WaitingLocation)
        private readonly waitingLocationRepository: Repository<WaitingLocation>,
        @InjectRepository(EmptyLocation)
        private readonly emptyLocationRepository: Repository<EmptyLocation>,
        @InjectRepository(Task)
        private readonly taskRepository: Repository<Task>,
        @InjectRepository(Settings)
        private readonly settingRepository: Repository<Settings>,

        private readonly emptyLocationService: EmptyLocationsService,
        private readonly settingsService: SettingsService
    ) {}

    async getInventories(): Promise<Inventory[]> {
        return await this.inventoryRepository.find();
    }
    async orderStats() {
        const orderItems = await this.orderItemRepository.find();
        const inventories = await this.inventoryRepository.find();
        const totalOrders = orderItems.length;
        const completedOrders = orderItems.filter(order => order.status === OrderItemStatus.COMPLETED).length;
        const assignedOrders = orderItems.filter(order => order.status === OrderItemStatus.ASSIGNED).length;
        const inProgressOrders = orderItems.filter(order => order.status === OrderItemStatus.IN_PROGRESS).length;
        const cancelledOrders = orderItems.filter(order => order.status === OrderItemStatus.CANCELLED).length;
        const startLocationStats = {};
        for (const order of orderItems) {
            const inventory_name = inventories.find(inv => inv.id === order.source_location_id)?.location_name || 'Unknown Location';
            if (!startLocationStats[inventory_name]) {
                startLocationStats[inventory_name] = {};
            }
            if (order.status === OrderItemStatus.COMPLETED) { startLocationStats[inventory_name].completed = (startLocationStats[inventory_name].completed || 0) + 1;  }
            else if (order.status === OrderItemStatus.IN_PROGRESS) { startLocationStats[inventory_name].inProgress = (startLocationStats[inventory_name].inProgress || 0) + 1; }
            else if (order.status === OrderItemStatus.CANCELLED) { startLocationStats[inventory_name].cancelled = (startLocationStats[inventory_name].cancelled || 0) + 1; }
            else if (order.status === OrderItemStatus.ASSIGNED) { startLocationStats[inventory_name].assigned = (startLocationStats[inventory_name].assigned || 0) + 1; }
        }
        const destionationLocationStats = {};
        for (const order of orderItems) {
            const gtpLocation = await this.gtpLocationRepository.findOne({ where: { gtp_location_id: order.destination_pallet_slot_id } });
            const station = gtpLocation ? await this.stationRepository.findOne({ where: { station_id: gtpLocation.station_id } }) : null;
            const station_name = station ? station.location_name : 'Unknown Station';
            if (!destionationLocationStats[station_name]) {
                destionationLocationStats[station_name] = {};
            }
            if (order.status === OrderItemStatus.COMPLETED) { destionationLocationStats[station_name].completed = (destionationLocationStats[station_name].completed || 0) + 1;  }
            else if (order.status === OrderItemStatus.IN_PROGRESS) { destionationLocationStats[station_name].inProgress = (destionationLocationStats[station_name].inProgress || 0) + 1; }
            else if (order.status === OrderItemStatus.CANCELLED) { destionationLocationStats[station_name].cancelled = (destionationLocationStats[station_name].cancelled || 0) + 1; }
            else if (order.status === OrderItemStatus.ASSIGNED) { destionationLocationStats[station_name].assigned = (destionationLocationStats[station_name].assigned || 0) + 1; }
        }
        console.log({
            totalOrders,
            completedOrders,
            assignedOrders,
            inProgressOrders,
            cancelledOrders,
            startLocationStats,
            destionationLocationStats
        })
        return {
            totalOrders,
            completedOrders,
            assignedOrders,
            inProgressOrders,
            cancelledOrders,
            startLocationStats,
            destionationLocationStats
        };
    }

    async ordersByTimeRange(require_detail?:boolean): Promise<OrderItem[]> {
        if (require_detail){
            return await this.orderItemRepository.find({ select: ['order_item_id','source_location_id','destination_pallet_slot_id']})
        }
        return await this.orderItemRepository.find({ select: ['order_item_id', 'created_at']});
    }

    async getStations(): Promise<Station[]> {
        return await this.stationRepository.find();
    }

    async getPickLocations(): Promise<GtpLocation[]> {
        return await this.gtpLocationRepository.find();
    }

    // Fixed: Parameter name matches the Tools definition
    async getStationFromPickLocation(args: { gtpLocationId: string }): Promise<Station | null> {
        const gtpLocation = await this.gtpLocationRepository.findOne({
            where: { gtp_location_id: args.gtpLocationId.toUpperCase() },
            relations: ['station']
        });
        return gtpLocation ? gtpLocation.station : null;
    }

    // Fixed: Return all GTP locations for a station, not just one
    async getPickLocationFromStation(args: { stationId: string }): Promise<GtpLocation[]> {
        const gtpLocations = await this.gtpLocationRepository.find({
            where: { station_id: args.stationId.toUpperCase() },
        });
        console.log(`stationId: ${JSON.stringify(args.stationId)}`);
        console.log(`gtpLocations: ${JSON.stringify(gtpLocations)}`);
        return gtpLocations;
    }


    async getWaitingLocations(): Promise<WaitingLocation[]> {
        return await this.waitingLocationRepository.find();
    }

    async getEmptyLocations(): Promise<EmptyLocation[]> {
        const res = await this.emptyLocationService.findAll();
        console.log(`Empty Locations: ${JSON.stringify(res)}`);
        return res;
    }
    async convertUtcToLocal(utcTimestamp: string): Promise<string> {
        const date = new Date(utcTimestamp);
        return date.toLocaleDateString();
    }
    async getLocalTime(){
        const date = new Date();
        return date.toLocaleDateString();
    }

    async taskStats(){
        const tasks = await this.taskRepository.find();
        const inventories = await this.inventoryRepository.find();
        const totalTasks = tasks.length;
        const completedTasks = tasks.filter(task => task.status === TaskStatus.COMPLETED || task.status === TaskStatus.TRIGERRED).length;
        const inProgressTasks = tasks.filter(task => task.status === TaskStatus.PROCESSING).length;
        const cancelledTasks = tasks.filter(task => task.status === TaskStatus.CANCELLED).length;
        const originLocationStats = {};
        for (const task of tasks) {
            const inventory_name = inventories.find(inv => inv.id === task.origin_location)?.location_name || 'Unknown Location';
            if (!originLocationStats[inventory_name]) {
                originLocationStats[inventory_name] = {};
            }
            
            if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.TRIGERRED) { originLocationStats[inventory_name].completed = (originLocationStats[inventory_name].completed || 0) + 1;  }
            else if (task.status === TaskStatus.PROCESSING) { originLocationStats[inventory_name].inProgress = (originLocationStats[inventory_name].inProgress || 0) + 1; }
            else if (task.status === TaskStatus.CANCELLED) { originLocationStats[inventory_name].cancelled = (originLocationStats[inventory_name].cancelled || 0) + 1; }
        }
        return {
            totalTasks,
            completedTasks,
            inProgressTasks,
            cancelledTasks,
            originLocationStats
        };
    }

    async tasksByTimeRange(require_detail?:boolean){
        if (require_detail){
            return await this.taskRepository.find({ select: ['task_id', 'start_location', 'end_location'] });
        }
        return await this.taskRepository.find({ select: ['task_id', 'created_at']});
    }

    async getContext(param: ContextParams): Promise<string>{
        const contexts = {
            [ContextParams.ORDER_ITEMS]: `
            1. destination_pallet_slot_id: ID of the GTP location or Pick Location where the order is assigned. Each GTP or Pick/Pallet slot is related to a station.
            2. order_batch_id: Groups order items that were uploaded together.
            3. source_location_id: ID of the inventory/quarantine location from where the item is picked.
            4. status: IN_PROGRESS - User has started processing, COMPLETED - Order completed, CANCELLED - Order cancelled.
            `,
            [ContextParams.GTP_LOCATIONS]: `
            1. gtp_location_id: ID of the GTP location or Pick Location or Pallet Slot.
            2. station_id: ID of the station to which this GTP location is assigned.`,
            [ContextParams.STATIONS]: `
            1. station_id: ID of the station.
            2. location_name: Name of the station.
            3. is_active: Station is not fit to work, take or complete orders.
            `,
            [ContextParams.EMPTY_LOCATIONS]: `
            1. location_id: ID of the empty location.
            2. status: Status of the empty location (e.g., available, occupied).
            3. is_active: Whether the empty locatio is fit taking empty pallets or not.
            4. location_name: Name of the empty location.
            `,
            [ContextParams.INVENTORY_LOCATIONS]:  `
            1. location_id: ID of the inventory location.
            2. location_name: Name of the inventory location.
            3. status: Status of the inventory location (e.g., available, occupied).
            `,
            [ContextParams.SETTINGS]:  `
            1. Empty Location Allocation Type: Strategy used for allocating empty locations (e.g., NEAREST, RANDOM).
            `
        };
        return contexts[param] || '';
    }
    async getRobots() {
        return this.settingsService.getAllRobots(TaskType.GOODS_TO_PERSON);
    }
    async settings(){
        return await this.settingRepository.find();
    }
}

export const Tools: ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'orderStats',
            description: 'Get all order items currently in the system',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getRobots',
            description: 'Get all robots in the warehouse system',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getStations',
            description: 'Get all stations in the warehouse',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getPickLocations',
            description: 'Get all pick locations (GTP locations) in the warehouse',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getStationFromPickLocation',
            description: 'Get station details from a pick location ID. Pick Location and GTP Location are the same.',
            parameters: {
                type: 'object',
                properties: {
                    gtpLocationId: {
                        type: 'string',
                        description: 'The ID of the GTP location (pick location)'
                    }
                },
                required: ['gtpLocationId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getEmptyLocations',
            description: 'Get all empty locations in the warehouse system',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getPickLocationFromStation',
            description: 'Get all pick locations (GTP locations) for a specified station ID.',
            parameters: {
                type: 'object',
                properties: {
                    stationId: {
                        type: 'string',
                        description: 'The ID of the station'
                    }
                },
                required: ['stationId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getOrderItemAssignedToPickLocation',
            description: 'Get order items assigned to a specific pick location. Pick Location is same as GTP Location.',
            parameters: {
                type: 'object',
                properties: {
                    gtpLocationId: {
                        type: 'string',
                        description: 'The ID of the GTP location (pick location)'
                    }
                },
                required: ['gtpLocationId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getLicensePlateNumberInitialRequirement',
            description: 'Get the initial quantity for a given license plate number',
            parameters: {
                type: 'object',
                properties: {
                    lp: {
                        type: 'string',
                        description: 'The license plate number'
                    }
                },
                required: ['lp']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getWaitingLocations',
            description: 'Get all waiting locations in the warehouse system',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getContext',
            description: 'Get context information for the bot to understand the system better',
            parameters: {
                type: 'object',
                properties: {
                    param: {
                        type: 'string',
                        enum: Object.values(ContextParams),
                        description: 'The context parameter to retrieve information for (e.g., order_items, gtp_locations, stations, empty_locations, inventory_locations, settings)'
                    }
                },
                required: ['param']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getInventories',
            description: 'Get all inventory locations in the warehouse system',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'convertUtcToLocal',
            description: 'Convert a UTC timestamp to a local date string based on the provided timezone',
            parameters: {
                type: 'object',
                properties: {
                    utcTimestamp: {
                        type: 'string',
                        description: 'The UTC timestamp to convert'
                    }
                },
                required: ['utcTimestamp']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getLocalTime',
            description: 'Get the current local date string',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'taskStats',
            description: 'Get statistics about tasks in the system',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'ordersByTimeRange',
            description: 'Get order items within a specified time range',
            parameters: {
                type: 'object',
                properties: {
                    require_detail: {
                        type: 'boolean',
                        description: 'Whether to include detailed information about each order item (optional)'
                    }
                },
                required: []
            }
        },
    },
    {
        type: 'function',
        function: {
            name: 'tasksByTimeRange',
            description: 'Get tasks within a specified time range',
            parameters: {
                type: 'object',
                properties: {
                    require_detail: {
                        type: 'boolean',
                        description: 'Whether to include detailed information about each task (optional)'
                    }
                },
                required: []
            }
        },
    },
    {
        type: 'function',
        function: {
            name: 'settings',
            description: 'Get all settings in the warehouse system - Empty Location Allocation Type',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    }
];