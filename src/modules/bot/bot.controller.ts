import { Body, Controller, Post } from '@nestjs/common';
import { BotService } from './bot.service';

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
  async handleBotRequest(@Body() body: BotRequest): Promise<BotResponse> {
    const result = await this.botService.processRequest(body);
    return result;
  }
}
