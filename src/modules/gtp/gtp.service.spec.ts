import { Test, TestingModule } from '@nestjs/testing';
import { GtpService } from './gtp.service';

describe('GtpService', () => {
  let service: GtpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GtpService],
    }).compile();

    service = module.get<GtpService>(GtpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
