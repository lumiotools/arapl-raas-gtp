import { Injectable } from '@nestjs/common';
import { BotRequest } from './bot.controller';
import { BotResponse } from './bot.controller';

@Injectable()
export class BotService {
  async processRequest(body: BotRequest): Promise<BotResponse> {
    const query = body.query;
    // Implement your bot logic here
    const response = `You asked: ${query}`;
    return { response };
  }
}
