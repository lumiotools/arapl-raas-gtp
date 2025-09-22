import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Log } from '../../entities/log.entity';
import { LoggingService } from '../../services/logging.service';
import { LogsController } from './logs.controller';
import { User } from 'src/entities/user.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Log, User])],
  controllers: [LogsController],
  providers: [LoggingService],
  exports: [LoggingService],
})
export class LoggingModule {}
