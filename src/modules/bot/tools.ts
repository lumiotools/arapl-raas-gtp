import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Inventory, OrderItem, Product, Station, GtpLocation, WaitingLocation } from "src/entities";
import { Repository } from "typeorm";
import { ChatCompletionTool } from 'openai/resources/chat/completions';

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
    ) {}

    async getAllInventory(): Promise<Inventory[]> {
        return await this.inventoryRepository.find();
    }

    async getAllProducts(): Promise<Product[]> {
        return await this.productRepository.find();
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

    // Fixed: Parameter name matches the Tools definition
    async getLicensePlateNumberRequirement(args: { lp: string }): Promise<number> {
        const orderItems = await this.orderItemRepository.find({
            where: { license_plate_id: args.lp.toUpperCase() },
            select: ['remaining_quantity']
        });
        return orderItems.reduce((total, item) => total + (item.remaining_quantity || 0), 0);
    }

    // Fixed: Parameter name matches the Tools definition
    async getLicensePlateNumberInitialRequirement(args: { lp: string }): Promise<number> {
        const orderItems = await this.orderItemRepository.find({
            where: { license_plate_id: args.lp.toUpperCase() },
            select: ['quantity']
        });
        return orderItems.reduce((total, item) => total + (item.quantity || 0), 0);
    }

    // Fixed: Parameter name matches the Tools definition
    async getOrderItemAssignedToPickLocation(args: { gtpLocationId: string }): Promise<OrderItem[]> {
        return await this.orderItemRepository.find({
            where: { assigned_gtp_location: args.gtpLocationId.toUpperCase() },
            relations: ['product']
        });
    }

    async getWaitingLocations(): Promise<WaitingLocation[]> {
        return await this.waitingLocationRepository.find();
    }
}

export const Tools: ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'getAllInventory',
            description: 'Get all inventory items in the warehouse system',
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
            name: 'getAllProducts',
            description: 'Get all products available in the system',
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
            name: 'getLicensePlateNumberRequirement',
            description: 'Get the total remaining quantity for a given license plate number',
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
    }
];