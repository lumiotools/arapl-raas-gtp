import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpStatus,
  HttpCode,
  Param,
  Body,
  UseGuards,
  Query,
  Patch,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiConsumes,
  ApiBody,
  ApiResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { OrdersService, OrderItemDetails } from './orders.service';
import { UploadResponseDto } from './dto/upload-order.dto';
import {
  BadRequestDto,
  InternalServerErrorDto,
} from './dto/error-responses.dto';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';
import { Role } from 'src/entities/user.entity';
import { OrdersCancelService } from './orders-cancel.service';


@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly ordersCancelService: OrdersCancelService,
  ) { }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload orders from CSV/Excel file',
    description:
      'Upload a CSV or Excel file containing order data to create orders and order items in the system.',
  })
  @ApiQuery({
    name: 'upload_mode',
    description: 'Mode of upload: "merge" to merge with existing orders, "transit" to create transit orders',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'CSV or Excel file containing order data with columns: source_location, destination_location',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'File processed successfully',
    type: UploadResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid file format, missing file, or processing error',
    type: BadRequestDto,
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error',
    type: InternalServerErrorDto,
  })
  async uploadOrders(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @Query() upload_mode: 'merge' | 'transit', // Body is not used but can be included for future extensions
  ): Promise<UploadResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const allowedExtensions = ['csv', 'xlsx', 'xls'];
    const fileExtension = file.originalname.split('.').pop()?.toLowerCase();

    if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
      throw new BadRequestException(
        'Invalid file format. Please upload a CSV or Excel file (.csv, .xlsx, .xls)',
      );
    }
    return await this.ordersService.processFile(file, body, upload_mode);
    // return await this.ordersService.processFile(file);
  }

  @Get('order-items')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all order items',
    description: 'Retrieve all order items from the database with their details.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved all order items',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Found 211 order items' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              created_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:48:08.647Z' },
              updated_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:48:08.647Z' },
              order_item_id: { type: 'number', example: 557 },
              order_batch_id: { type: 'string', example: 'Batch-1766566088396' },
              source_location_id: { type: 'string', example: 'R10X04' },
              destination_pallet_slot_id: { type: 'string', example: 'PL002' },
              status: { type: 'string', example: 'ASSIGNED' },
              merged_order_item_id: { type: 'number', nullable: true, example: null },
              destinationPalletSlot: {
                type: 'object',
                properties: {
                  created_at: { type: 'string', format: 'date-time', example: '2025-12-13T12:45:01.508Z' },
                  updated_at: { type: 'string', format: 'date-time', example: '2025-12-13T12:45:01.508Z' },
                  gtp_location_id: { type: 'string', example: 'PL002' },
                  station_id: { type: 'string', example: 'ST002' },
                  is_active: { type: 'boolean', example: true },
                  status: { type: 'string', example: 'AVAILABLE' }
                }
              }
            }
          }
        }
      }
    }
  })
    @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error',
    type: InternalServerErrorDto,
  })
  async getAllOrderItems() {
    return await this.ordersService.getAllOrderItems();
  }

  // @Post('order-completed-tasks')
  // @HttpCode(HttpStatus.OK)
  // @ApiOperation({
  //   summary: 'Get completed tasks for order items',
  //   description: 'Retrieve all completed tasks associated with the provided order_item_id list.',
  // })
  // @ApiBody({
  //   schema: {
  //     type: 'object',
  //     properties: {
  //       order_item_ids: {
  //         type: 'array',
  //         items: { type: 'number' },
  //         description: 'List of order_item_id to fetch completed tasks for',
  //         example: [1, 2, 3]
  //       }
  //     },
  //     required: ['order_item_ids']
  //   }
  // })
  // @ApiResponse({
  //   status: HttpStatus.OK,
  //   description: 'Successfully retrieved completed tasks',
  //   type: Array,
  // })
  // async getCompletedTasksForOrderItems(
  //   @Body() body: { order_item_ids: number[] }
  // ) {
  //   return await this.ordersService.getCompletedTasksForOrderItems(body.order_item_ids);
  // }

  @Get('gtp-location-status/:gtpLocationId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  @ApiOperation({
    summary: 'Get Pick Location status',
    description: 'Returns the status (boolean) for the specified Pick Location.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved status for the Pick Location',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'boolean', example: true }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid Pick Location ID',
    type: BadRequestDto,
  })
  async getGtpLocationStatus(
    @Param('gtpLocationId') gtpLocationId: string
  ): Promise<{ status: boolean }> {
    return await this.ordersService.getGtpLocationStatus(gtpLocationId);
  }
  @Get('by-status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  @ApiOperation({
    summary: 'Get orders by status and time range',
    description: 'Retrieve all orders filtered by their status and optionally by time range. Multiple statuses can be provided as comma-separated values.',
  })
  @ApiQuery({
    name: 'status',
    description: 'Comma-separated list of order statuses to filter by (e.g., PENDING,COMPLETED)',
    example: 'PENDING,COMPLETED',
    required: true,
  })
  @ApiQuery({
    name: 'start_time',
    description: 'Optional start time to filter orders created after this time (ISO 8601 format)',
    example: '2025-08-19T09:00:00',
    required: false,
  })
  @ApiQuery({
    name: 'end_time',
    description: 'Optional end time to filter orders created before this time (ISO 8601 format)',
    example: '2025-08-19T17:00:00',
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved orders by status and time range',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Found 5 orders with status PENDING, COMPLETED' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              order_item_id: { type: 'number', example: 557 },
              order_batch_id: { type: 'string', example: 'Batch-1766566088396' },
              source_location_id: { type: 'string', example: 'R10X04' },
              destination_station_id: { type: 'string', example: 'ST002' },
              status: { type: 'string', example: 'ASSIGNED' },
              robot_ids: {
                type: 'array',
                items: { type: 'string' },
                example: []
              },
              total_unloading_time: { type: 'number', example: 0 },
              start_time: { type: 'string', format: 'date-time', example: '2025-12-24T08:48:08.647Z' },
              created_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:48:08.647Z' },
              updated_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:48:08.647Z' },
              completedTasks: {
                type: 'array',
                items: { type: 'object' },
                example: []
              }
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid status parameter or time range',
    type: BadRequestDto,
  })
  async getOrdersByStatus(
    @Query('status') status: string,
    @Query('start_time') startTime?: string,
    @Query('end_time') endTime?: string
  ): Promise<OrderItemDetails[]> {
    if (!status) {
      throw new BadRequestException('Status query parameter is required');
    }

    // Split comma-separated statuses and trim whitespace
    const statusList = status.split(',').map(s => s.trim()).filter(s => s.length > 0);

    if (statusList.length === 0) {
      throw new BadRequestException('At least one valid status must be provided');
    }

    // Validate time parameters if provided
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (startTime) {
      startDate = new Date(startTime);
      if (isNaN(startDate.getTime())) {
        throw new BadRequestException('Invalid start_time format. Use ISO 8601 format (e.g., 2025-08-19T09:00:00)');
      }
    }

    if (endTime) {
      endDate = new Date(endTime);
      if (isNaN(endDate.getTime())) {
        throw new BadRequestException('Invalid end_time format. Use ISO 8601 format (e.g., 2025-08-19T17:00:00)');
      }
    }

    if (startDate && endDate && startDate >= endDate) {
      throw new BadRequestException('start_time must be before end_time');
    }

    return await this.ordersService.getOrdersByStatus(statusList, startDate, endDate);
  }

  @Get('station-report/summary')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  @ApiOperation({
    summary: 'Get station report summary',
    description: 'Returns a summary report for stations within the specified date range.',
  })
  @ApiQuery({
    name: 'start_time',
    description: 'Optional start time to filter station report (ISO 8601 format)',
    example: '2025-08-19T09:00:00',
    required: false,
  })
  @ApiQuery({
    name: 'end_time',
    description: 'Optional end time to filter station report (ISO 8601 format)',
    example: '2025-08-19T17:00:00',
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved station report summary',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          completed: { type: 'number', example: 93 },
          in_progress: { type: 'number', example: 1 },
          cancelled: { type: 'number', example: 8 },
          pending: { type: 'number', example: 0 },
          assigned: { type: 'number', example: 4 }
        }
      },
      example: {
        ST001: {
          completed: 93,
          in_progress: 1,
          cancelled: 8,
          pending: 0,
          assigned: 4
        },
        ST002: {
          completed: 92,
          in_progress: 1,
          cancelled: 8,
          pending: 0,
          assigned: 4
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid date format or missing parameters',
    type: BadRequestDto,
  })
  async getStationReportSummary(
    @Query('start_time') startTime?: string,
    @Query('end_time') endTime?: string
  ) {
    // Validate time parameters if provided
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (startTime) {
      startDate = new Date(startTime);
      if (isNaN(startDate.getTime())) {
        throw new BadRequestException('Invalid start_time format. Use ISO 8601 format (e.g., 2025-08-19T09:00:00)');
      }
    }

    if (endTime) {
      endDate = new Date(endTime);
      if (isNaN(endDate.getTime())) {
        throw new BadRequestException('Invalid end_time format. Use ISO 8601 format (e.g., 2025-08-19T17:00:00)');
      }
    }

    if (startDate && endDate && startDate >= endDate) {
      throw new BadRequestException('start_time must be before end_time');
    }
    return await this.ordersService.getStationReportSummary(startDate, endDate);
  }

  @Get('inventory-report/summary')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  @ApiOperation({
    summary: 'Get inventory report summary',
    description: 'Returns a summary report for inventory within the specified date range.',
  })
  @ApiQuery({
    name: 'start_time',
    description: 'Optional start time to filter inventory report (ISO 8601 format)',
    example: '2025-08-19T09:00:00',
    required: false,
  })
  @ApiQuery({
    name: 'end_time',
    description: 'Optional end time to filter inventory report (ISO 8601 format)',
    example: '2025-08-19T17:00:00',
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved inventory report summary',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          completed: { type: 'number', example: 29 },
          in_progress: { type: 'number', example: 0 },
          cancelled: { type: 'number', example: 4 },
          pending: { type: 'number', example: 0 },
          assigned: { type: 'number', example: 2 },
          is_quarantine: { type: 'boolean', example: false }
        }
      },
      example: {
        R10X03: {
          completed: 29,
          in_progress: 0,
          cancelled: 4,
          pending: 0,
          assigned: 2,
          is_quarantine: false
        },
        R10X23: {
          completed: 31,
          in_progress: 0,
          cancelled: 4,
          pending: 0,
          assigned: 0,
          is_quarantine: false
        },
        R10X01: {
          completed: 33,
          in_progress: 0,
          cancelled: 1,
          pending: 0,
          assigned: 2,
          is_quarantine: false
        },
        R10X02: {
          completed: 30,
          in_progress: 1,
          cancelled: 3,
          pending: 0,
          assigned: 1,
          is_quarantine: false
        },
        R10X04: {
          completed: 31,
          in_progress: 0,
          cancelled: 2,
          pending: 0,
          assigned: 2,
          is_quarantine: true
        },
        R20X01: {
          completed: 31,
          in_progress: 1,
          cancelled: 2,
          pending: 0,
          assigned: 1,
          is_quarantine: false
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid date format or missing parameters',
    type: BadRequestDto,
  })
  async getInventoryReportSummary(
    @Query('start_time') startTime?: string,
    @Query('end_time') endTime?: string
  ) {
    // Validate time parameters if provided
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (startTime) {
      startDate = new Date(startTime);
      if (isNaN(startDate.getTime())) {
        throw new BadRequestException('Invalid start_time format. Use ISO 8601 format (e.g., 2025-08-19T09:00:00)');
      }
    }

    if (endTime) {
      endDate = new Date(endTime);
      if (isNaN(endDate.getTime())) {
        throw new BadRequestException('Invalid end_time format. Use ISO 8601 format (e.g., 2025-08-19T17:00:00)');
      }
    }

    if (startDate && endDate && startDate >= endDate) {
      throw new BadRequestException('start_time must be before end_time');
    }
    return await this.ordersService.getInventoryReportSummary(startDate, endDate);
  }

  @Get('source/gtp-location/:gtp_location_id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'flowops.operator', 'flowops.admin')
  @ApiOperation({
    summary: 'Get source inventory by Pick Location',
    description: 'Retrieve all source associated with the specified Pick Location ID.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved source inventory for the Pick Location',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          totalOrder: { type: 'number', example: 15 },
          completed: { type: 'number', example: 12 }
        },
        additionalProperties: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'COMPLETED' },
            merged_order_item_id: { type: 'number', nullable: true, example: null }
          }
        }
      },
      example: {
        R10X04: {
          '352': {
            status: 'CANCELLED',
            merged_order_item_id: null
          },
          '364': {
            status: 'COMPLETED',
            merged_order_item_id: null
          },
          '551': {
            status: 'ASSIGNED',
            merged_order_item_id: null
          },
          totalOrder: 15,
          completed: 12
        },
        R10X03: {
          '351': {
            status: 'CANCELLED',
            merged_order_item_id: null
          },
          '363': {
            status: 'COMPLETED',
            merged_order_item_id: null
          },
          '550': {
            status: 'ASSIGNED',
            merged_order_item_id: null
          },
          totalOrder: 15,
          completed: 13
        },
        R10X01: {
          '350': {
            status: 'COMPLETED',
            merged_order_item_id: null
          },
          '549': {
            status: 'ASSIGNED',
            merged_order_item_id: null
          },
          totalOrder: 16,
          completed: 15
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid Pick Location ID',
    type: BadRequestDto,
  })
  async getSourceByGtpLocation(
    @Param('gtp_location_id') gtpLocationId: string
  ) {
    if (!gtpLocationId) {
      throw new BadRequestException('Pick Location ID is required');
    }
    return await this.ordersService.getSourceByGtpLocation(gtpLocationId);
  }
  @Post('order-completed-tasks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get completed tasks for order items',
    description: 'Retrieve all completed tasks associated with the provided order_item_id list.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        order_item_ids: {
          type: 'array',
          items: { type: 'number' },
          description: 'List of order_item_id to fetch completed tasks for',
          example: [1, 2, 3]
        }
      },
      required: ['order_item_ids']
    }
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved completed tasks',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: {
          type: 'string',
          format: 'uuid'
        }
      },
      example: {
        "546": [
          "af84992d-ef3b-45f2-aad6-b98a0150f71d",
          "29d59ac0-df60-4b17-8446-53dde49e93ec"
        ]
      }
    }
  })
  async getCompletedTasksForOrderItems(
    @Body() body: { order_item_ids: number[] }
  ) {
    return await this.ordersService.getCompletedTasksForOrderItems(body.order_item_ids);
  }

  @Patch('order-item/cancel/:order_item_id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  @ApiOperation({
    summary: 'Cancel order item',
    description: 'Cancel an order item by its ID. Optionally, specify if the item is a group using the is_group query parameter.',
  })
  @ApiParam({
    name: 'order_item_id',
    description: 'The ID of the order item to be canceled',
    example: 557
  })
  @ApiQuery({
    name: 'is_group',
    description: 'Optional flag to indicate if the order item is a group',
    required: false,
    example: false
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order item cancelled successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Order item cancelled successfully' }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid order_item_id or parameters',
    type: BadRequestDto,
  })
  async cancelOrderItem(
    @Param('order_item_id') orderItemId: number,
    @Query('is_group') isGroup?: boolean,
  ) {
    if (!orderItemId) {
      throw new BadRequestException('order_item_id is required');
    }
    return await this.ordersService.cancelOrderItem(orderItemId, isGroup);
  }

  @Patch('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an order or task',
    description: 'Cancel an order by task ID or order item ID. Optionally specify a quarantine location and reason for cancellation.',
  })
  @ApiQuery({
    name: 'task_id',
    description: 'The task ID associated with the order to be canceled',
    required: false,
    example: 'ae46809c-1802-401f-9f0f-377632bdc758'
  })
  @ApiQuery({
    name: 'order_item_id',
    description: 'The order item ID to be canceled',
    required: false,
    example: 557
  })
  @ApiQuery({
    name: 'quarantine_location_id',
    description: 'Optional quarantine location ID where items will be moved upon cancellation',
    required: false,
    example: 'QUAR001'
  })
  @ApiQuery({
    name: 'reason',
    description: 'Reason for cancellation',
    required: false,
    example: 'retry'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order or task canceled successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Order/task canceled successfully' },
        data: { type: 'object' }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid parameters for cancellation',
    type: BadRequestDto,
  })
  async cancel(
    @Query('task_id') task_id?: string,
    @Query('order_item_id') order_item_id?: number,
    @Query('quarantine_location_id') quarantine_location_id?: string,
    @Query('reason') reason: 'retry' | 'reassign' | 'back_to_inventory' | 'just_cancel' = 'retry',
  ) {
    return await this.ordersCancelService.cancel(task_id, order_item_id, reason, quarantine_location_id);
  }

  @Patch('pre-cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancellation check for an order or task',
    description: 'Check cancellation conditions for an order by task ID or order item ID. Optionally specify a quarantine location and reason for cancellation.',
  })
  @ApiQuery({
    name: 'task_id',
    description: 'The task ID associated with the order to be canceled',
    required: false,
    example: 'ae46809c-1802-401f-9f0f-377632bdc758'
  })
  @ApiQuery({
    name: 'order_item_id',
    description: 'The order item ID to be canceled',
    required: false,
    example: 557
  })
  @ApiQuery({
    name: 'quarantine_location_id',
    description: 'Optional quarantine location ID where items will be moved upon cancellation',
    required: false,
    example: 'QUAR001'
  })
  @ApiQuery({
    name: 'reason',
    description: 'Reason for cancellation',
    required: false,
    example: 'retry'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid parameters for cancellation',
    type: BadRequestDto,
  })
  @HttpCode(HttpStatus.OK)
  async preCancel(
    @Query('task_id') task_id?: string,
    @Query('order_item_id') order_item_id?: number,
    @Query('quarantine_location_id') quarantine_location_id?: string,
    @Query('reason') reason: 'retry' | 'reassign' | 'back_to_inventory' | 'just_cancel' = 'retry',
  ) {
    return await this.ordersCancelService.precancel(task_id, order_item_id, reason, quarantine_location_id);
  }
}
