import { Test, TestingModule } from '@nestjs/testing';
import { WaitingLocationController } from './waiting_location.controller';
import { WaitingLocationService } from './waiting_location.service';

describe('WaitingLocationController', () => {
  let controller: WaitingLocationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WaitingLocationController],
      providers: [WaitingLocationService],
    }).compile();

    controller = module.get<WaitingLocationController>(WaitingLocationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
