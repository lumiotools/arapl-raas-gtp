import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { dashboard } from 'src/entities/dashboard.entity'; // Import the dashboard entity

@Module({
  imports: [TypeOrmModule.forFeature([dashboard])], // Import the dashboard entity
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
