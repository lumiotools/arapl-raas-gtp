import { Module } from '@nestjs/common';
import { DatabaseResetController } from './database-reset.controller';
import { DatabaseResetService } from './database-reset.service';

@Module({
  controllers: [DatabaseResetController],
  providers: [DatabaseResetService],
  exports: [DatabaseResetService],
})
export class DatabaseResetModule {}
