import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { BotService } from './bot.service';
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse } from '@nestjs/swagger';

interface History {
  role: 'user' | 'assistant';
  content: string;
}

export interface BotRequest{
  'chat_history': History[],
  'query': string;
}
export interface BotResponse {
  'response': string;
}

@Controller('bot')
export class BotController {
  constructor(private readonly botService: BotService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Handle bot request',
    description: 'Processes a bot request with chat history and query.'
  })
  @ApiConsumes('application/json')
  @ApiBody({ schema: {type: 'object', properties:{chat_history: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } } }, query: { type: 'string' }}} })
  @ApiResponse({
    status: 200,
    description: 'The bot response.',
    schema: {
      type: 'object',
      properties: {
        response: { type: 'string' }
      }
    }
  })
  async handleBotRequest(@Body() body: BotRequest): Promise<BotResponse> {
    const result = await this.botService.processRequest(body);
    return result;
  }
}
