import { Controller, Post, Body, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import { WebhookRequestDto } from './dto/webhook-request.dto';

@ApiTags('Webhook')
@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  @ApiOperation({
    summary: 'Receive status updates from WMS API layer',
    description: 'Webhook endpoint to receive batch and task status updates from the WMS API layer and update the database accordingly.',
  })
  @ApiBody({ type: WebhookRequestDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Webhook processed successfully',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Webhook processed successfully'
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid webhook data',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'Invalid webhook data' },
        error: { type: 'string', example: 'Bad Request' }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Batch or task not found',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 404 },
        message: { type: 'string', example: 'Batch with ID B1540497671 not found' },
        error: { type: 'string', example: 'Not Found' }
      }
    }
  })
  async handleWebhook(@Body() webhookData: any) {
    // console.log(`received webhook: ${JSON.stringify(webhookData)}`);
    return await this.webhookService.processWebhook(webhookData);
  }
}
