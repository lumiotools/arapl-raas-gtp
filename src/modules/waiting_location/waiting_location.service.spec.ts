import { Test, TestingModule } from '@nestjs/testing';
import { WaitingLocationService } from './waiting_location.service';

describe('WaitingLocationService', () => {
  let service: WaitingLocationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WaitingLocationService],
    }).compile();

    service = module.get<WaitingLocationService>(WaitingLocationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
