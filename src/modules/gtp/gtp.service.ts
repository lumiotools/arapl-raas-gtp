import { Injectable } from '@nestjs/common';
import { CreateGtpDto } from './dto/create-gtp.dto';
import { UpdateGtpDto } from './dto/update-gtp.dto';

@Injectable()
export class GtpService {
  create(createGtpDto: CreateGtpDto) {
    return 'This action adds a new gtp';
  }

  findAll() {
    return `This action returns all gtp`;
  }

  findOne(id: number) {
    return `This action returns a #${id} gtp`;
  }

  update(id: number, updateGtpDto: UpdateGtpDto) {
    return `This action updates a #${id} gtp`;
  }

  remove(id: number) {
    return `This action removes a #${id} gtp`;
  }
}
