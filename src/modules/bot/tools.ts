import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Inventory, OrderItem, Product, Station, GtpLocation, WaitingLocation } from "src/entities";
import { Repository } from "typeorm";
import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { EmptyLocation } from "src/entities/empty-location.entity";
import { EmptyLocationsService } from "../empty_locations/empty_locations.service";

enum ContextParams {
    ORDER_ITEMS = 'order_items',
    GTP_LOCATIONS = 'gtp_locations',
    STATIONS = 'stations',
    EMPTY_LOCATIONS = 'empty_locations',
    INVENTORY_LOCATIONS = 'inventory_locations'
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

        private readonly emptyLocationService: EmptyLocationsService,
    ) {}

    async getInventories(): Promise<Inventory[]> {
        return await this.inventoryRepository.find();
    }
    async getOrderItems(): Promise<OrderItem[]> {
        return await this.orderItemRepository.find();
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

    async getContext(param: ContextParams): Promise<string>{
        const contexts = {
            [ContextParams.ORDER_ITEMS]: `
            1. assigned_gtp_location: ID of the GTP location or Pick Location. One License Plate can be assigned to only 
            one Pick Location. Assigned GTP (Pick Location) location can be used to find corresponding station.
            `,
            [ContextParams.GTP_LOCATIONS]: `
            1. gtp_location_id: ID of the GTP location or Pick Location.
            2. station_id: ID of the station to which this GTP location is assigned.`,
            [ContextParams.STATIONS]: `
            1. station_id: ID of the station.`,
            [ContextParams.EMPTY_LOCATIONS]: `
            1. location_id: ID of the empty location.
            2. location_description: Description of the empty location.
            3. status: Status of the empty location (e.g., available, occupied).
            4. is_active: Indicates if the empty location is active or inactive. If active, need to be included in the response.
            `,
            [ContextParams.INVENTORY_LOCATIONS]:  `
            1. location_id: ID of the inventory location.
            2. location_description: Description of the inventory location.
            3. status: Status of the inventory location (e.g., available, occupied).
            4. is_active: Indicates if the inventory location is active or inactive. If active, need to be included in the response.
            5. is_empty: Indicates if the inventory location is at empty location or not.
            6. isProcessing: Indicates if the inventory location is being OCCUPIED or not.
            `
        };
        return contexts[param] || '';
    }
}

export const Tools: ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'getOrderItems',
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
                        description: 'The context parameter to retrieve information for'
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
    }
];