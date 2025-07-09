import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Log } from '../../entities/log.entity';
import { LoggingService } from '../../services/logging.service';
import { LogsController } from './logs.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Log])],
  controllers: [LogsController],
  providers: [LoggingService],
  exports: [LoggingService],
})
export class LoggingModule {}
