import { Body, Controller, Post } from '@nestjs/common';
import { BotService } from './bot.service';

export interface BotRequest{
  'query': string;
}
export interface BotResponse {
  'response': string;
}

@Controller('bot')
export class BotController {
  constructor(private readonly botService: BotService) {}

  @Post('bot')
  async handleBotRequest(@Body() body: BotRequest): Promise<BotResponse> {
    const result = await this.botService.processRequest(body);
    return result;
  }
}
