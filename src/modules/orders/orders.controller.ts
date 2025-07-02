import {
  Controller,
  Post,
  Get,
  Put,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpStatus,
  HttpCode,
  Param,
  Body,
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
}
