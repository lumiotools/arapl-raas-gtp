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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiConsumes,
  ApiBody,
  ApiResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { UploadResponseDto } from './dto/upload-order.dto';
import {
  BadRequestDto,
  InternalServerErrorDto,
} from './dto/error-responses.dto';
import { JwtAuthGuard } from '../auth/guard/auth.guard';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
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

    return await this.ordersService.processFile(file);
  }

  @Post('assignments/upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload location assignments from CSV file',
    description:
      'Upload a CSV file containing location assignment data to assign GTP locations.',
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
            'CSV file containing location assignment data with columns: Location ID, GTP ID',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
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
  async uploadAssignments(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const allowedExtensions = ['csv'];
    const fileExtension = file.originalname.split('.').pop()?.toLowerCase();

    if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
      throw new BadRequestException(
        'Invalid file format. Please upload a CSV file (.csv)',
      );
    }

    return await this.ordersService.processAssignmentsFile(file);
  }

  @Get('available-license-plates')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get available license plates',
    description: 'Retrieve all license plates that do not have assigned GTP locations.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved available license plates',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Found 12 available license plates' },
        data: { 
          type: 'array', 
          items: { type: 'string' },
          example: ['LP001', 'LP002', 'LP003']
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Bad request',
    type: BadRequestDto,
  })
  async getAvailableLicensePlates() {
    return await this.ordersService.getAvailableLicensePlates();
  }

  @Put('license-plate-mapping')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Map license plate to GTP location',
    description: 'Assign a license plate to a specific GTP location.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        licensePlateId: { type: 'string', example: 'LP001' },
        gtpLocationId: { type: 'string', example: 'GTP001' }
      },
      required: ['licensePlateId', 'gtpLocationId']
    }
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully mapped license plate to GTP location',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Successfully mapped license plate LP001 to GTP location GTP001 for 3 order items' },
        data: {
          type: 'object',
          properties: {
            licensePlateId: { type: 'string', example: 'LP001' },
            gtpLocationId: { type: 'string', example: 'GTP001' },
            affectedItems: { type: 'number', example: 3 }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid data provided',
    type: BadRequestDto,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'GTP location already assigned to another license plate',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 403 },
        message: { type: 'string', example: 'GTP Location GTP001 is already assigned to license plate LP005' },
        error: { type: 'string', example: 'Forbidden' }
      }
    }
  })
  async mapLicensePlateToGtpLocation(
    @Body() mappingData: { licensePlateId: string; gtpLocationId: string }
  ) {
    return await this.ordersService.mapLicensePlateToGtpLocation(
      mappingData.licensePlateId,
      mappingData.gtpLocationId
    );
  }

  @Get('order-items')
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

  @Delete('license-plate-mapping/:licensePlateId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove license plate to GTP location mapping',
    description: 'Remove the GTP location assignment from a license plate by setting it to null. Only works if status is ASSIGNED.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully removed license plate to GTP location mapping',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Successfully removed GTP location mapping for license plate LP001. 3 order items updated.' },
        data: {
          type: 'object',
          properties: {
            licensePlateId: { type: 'string', example: 'LP001' },
            previousGtpLocationId: { type: 'string', example: 'GTP001' },
            affectedItems: { type: 'number', example: 3 }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'License plate not found or invalid status',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'Cannot remove mapping: Order items with license plate LP001 are not in ASSIGNED status' },
        error: { type: 'string', example: 'Bad Request' }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'License plate not found or no GTP mapping exists',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 404 },
        message: { type: 'string', example: 'No order items found with license plate LP001 or no GTP mapping exists' },
        error: { type: 'string', example: 'Not Found' }
      }
    }
  })
  async removeLicensePlateMapping(
    @Param('licensePlateId') licensePlateId: string
  ) {
    return await this.ordersService.removeLicensePlateMapping(licensePlateId);
  }
}
