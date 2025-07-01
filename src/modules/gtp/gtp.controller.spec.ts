import { Test, TestingModule } from '@nestjs/testing';
import { GtpController } from './gtp.controller';
import { GtpService } from './gtp.service';

describe('GtpController', () => {
  let controller: GtpController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GtpController],
      providers: [GtpService],
    }).compile();

    controller = module.get<GtpController>(GtpController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
