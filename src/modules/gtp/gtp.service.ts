import { Injectable } from '@nestjs/common';
import { CreateGtpDto } from './dto/create-gtp.dto';
import { UpdateGtpDto } from './dto/update-gtp.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GtpLocation } from 'src/entities/gtp-location.entity'; // Assuming you have a Gtp entity defined

@Injectable()
export class GtpService {
  constructor(
    @InjectRepository(GtpLocation)
    private readonly gtpRepository: Repository<GtpLocation>,
  ) {}
  create(createGtpDto: GtpLocation) {
    const newGtp = this.gtpRepository.create(createGtpDto);
    return this.gtpRepository.save(newGtp);
  }

  findAll() {
    return `This action returns all gtp`;
  }

  findOne(id: string) {
    return this.gtpRepository.findOne({where: { gtp_location_id: id}});
    // return `This action returns a #${id} gtp`;
  }

  update(id: string, updateGtpDto: GtpLocation) {
    return this.gtpRepository.update(id, updateGtpDto).then(() => {
      return this.gtpRepository.findOne({where: { gtp_location_id: id}});
    });
    // return `This action updates a #${id} gtp`;
  }

  remove(id: string) {
    return this.gtpRepository.delete(id).then(() => {
      return { message: `GTP with id ${id} has been removed` };
    });
    // return `This action removes a #${id} gtp`;
  }
}
