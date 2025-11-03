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
  constructor(private readonly ordersService: OrdersService,
    private readonly ordersCancelService: OrdersCancelService
  ) {}

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
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'CSV or Excel file containing order data with columns: Order ID, Product Id, Qty, License Plate ID',
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
        message: { type: 'string', example: 'Found 25 order items' },
        data: { 
          type: 'array', 
          items: {
            type: 'object',
            properties: {
              order_item_id: { type: 'number', example: 1 },
              order_id: { type: 'string', example: 'ORD001' },
              product_id: { type: 'string', example: 'PROD001' },
              quantity: { type: 'number', example: 10 },
              license_plate_id: { type: 'string', example: 'LP001' },
              status: { type: 'string', example: 'PENDING' },
              created_at: { type: 'string', format: 'date-time' },
              updated_at: { type: 'string', format: 'date-time' },
              assignedGtpLocation: {
                type: 'object',
                properties: {
                  gtp_location_id: { type: 'string', example: 'GTP001' },
                  station_id: { type: 'string', example: 'STA001' }
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
    summary: 'Get GTP location status',
    description: 'Returns the status (boolean) for the specified GTP location.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved status for the GTP location',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'boolean', example: true }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid GTP location ID',
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
          order_id: { type: 'string', example: 'ORD001' },
          status: { type: 'string', example: 'PENDING' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
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
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved station report summary',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Station report summary generated' },
        data: { type: 'array', items: { type: 'object' } }
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

  @Get('source/gtp-location/:gtp_location_id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'flowops.operator','flowops.admin')
  @ApiOperation({
    summary: 'Get source by GTP location',
    description: 'Retrieve all source associated with the specified GTP location ID.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved source for the GTP location',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Found 3 sources for GTP location GTP001' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source_id: { type: 'string', example: 'SRC001' },
              order_id: { type: 'string', example: 'ORD001' },
              status: { type: 'string', example: 'ACTIVE' },
              created_at: { type: 'string', format: 'date-time' },
              updated_at: { type: 'string', format: 'date-time' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid GTP location ID',
    type: BadRequestDto,
  })
  async getSourceByGtpLocation(
    @Param('gtp_location_id') gtpLocationId: string
  ) {
    if (!gtpLocationId) {
      throw new BadRequestException('GTP location ID is required');
    }
    return await this.ordersService.getSourceByGtpLocation(gtpLocationId);
  }

  @Post('order-completed-tasks')
  @HttpCode(HttpStatus.OK)
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
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order item cancelled successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Order item cancelled successfully' },
        data: { type: 'object' }
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
    return await this.ordersCancelService.cancelOrderItem(orderItemId, isGroup);
  }

  @Patch('cancel/task/:task_id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  async cancelOrderByTaskId(
    @Param('task_id') taskId: string,
  ) {
    if (!taskId) {
      throw new BadRequestException('task_id is required');
    }
    return await this.ordersCancelService.cancelOrderByTaskId(taskId);
  }

  @Post('retry/:task_id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  async retryOrderByTaskId(
    @Param('task_id') taskId: string,
  ) {
    if (!taskId) {
      throw new BadRequestException('task_id is required');
    }
    await this.ordersCancelService.retryOrderByTaskId(taskId);
    return {
      success: true,
      message: 'Erroneous task handled successfully',
      task_id: taskId
    };
  }

  @Post('retry-order-item/:order_item_id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  async retryOrderItem(
    @Param('order_item_id') orderItemId: number,
  ) {
    if (!orderItemId) {
      throw new BadRequestException('order_item_id is required');
    }
    return await this.ordersCancelService.retryOrderItem(orderItemId);
  }

  @Post('reassign-order-item/:order_item_id/:location_id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  async reassignOrderItemLocation(
    @Param('order_item_id') orderItemId: number,
    @Param('location_id') locationId: string,
  ) {
    if (!orderItemId || !locationId) {
      throw new BadRequestException('order_item_id and location_id are required');
    }
    return await this.ordersCancelService.reassignOrderItemLocation(orderItemId, locationId);
  }

  @Post('reassign-task/:task_id/:location_id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  async reassignTaskLocation(
    @Param('task_id') taskId: string,
    @Param('location_id') locationId: string,
  ) {
    if (!taskId || !locationId) {
      throw new BadRequestException('task_id and location_id are required');
    }
    return await this.ordersCancelService.reassignTaskLocation(taskId, locationId);
  }
}
