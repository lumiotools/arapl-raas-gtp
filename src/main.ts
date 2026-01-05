import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS for development
  app.enableCors({
    origin: [
      'http://10.10.2.90:3000', // Added Vercel frontend URL
      'http://localhost:3030', // Local development URL
      'http://localhost:3000', // Local development URL
      'http://localhost:9000', // Local development URL
      'https://arapl-raas-wms-api-layer.onrender.com',
    ],
    credentials: true, // Important for cookies
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  
  // Add global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  app.use(cookieParser());

  const config = new DocumentBuilder()
    .setTitle('ARAPL RaaS GTP API')
    .setDescription(`
      Goods To Person (GTP) API for ARAPL RaaS (Robotics as a Service)

      This API provides comprehensive GTP capabilities including:
      - Order management and file upload processing
      - Moveops location management
      - Station management and Pallet Slot assignments
      - Inventory tracking and bulk operations
      
      All endpoints include proper validation, error handling, and support file uploads where applicable.
    `)
    .setVersion('1.0.0')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'authorization',
        in: 'header',
        description: 'API Key for authentication'
      },
      'api-key',
    )
    .addTag('Orders', 'Order management, file uploads, and cancellations.')
    .addTag('Pick Locations', 'Pick location management and configuration')
    .addTag('Stations', 'Station management and Pallet Slot assignments')
    .addTag('Inventory', 'Inventory tracking, management, and bulk operations')
    .addTag('Orchestrator', 'Task orchestration and batch processing for warehouse operations')
    .addTag('BaseOps Tasks', 'BaseOps task management, batch operations, and task processing')
    .addTag('CrossDock Tasks', 'CrossDock task management, batch operations, pause/resume/retry, and task processing')
    .addTag('WMS Integration Wrapper', 'WMS integration endpoints for creating and retrieving batch jobs')
    .addTag('Webhook', 'Webhook endpoints for receiving status updates from WMS API layer')
    .build();
  
  

  const document = SwaggerModule.createDocument(app, config);
  const swaggerDir = join(process.cwd(), 'docs', 'swagger');
  if (!existsSync(swaggerDir)) {
    mkdirSync(swaggerDir, { recursive: true });
  }
  writeFileSync(
    './docs/swagger/swagger-spec.json',
    JSON.stringify(document, null, 2),
  );
  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  await app.listen(process.env.PORT ?? 8000);
  console.log(`
🚀 Application is running on: http://localhost:${process.env.PORT ?? 8000}
📚 Swagger API Documentation: http://localhost:${process.env.PORT ?? 8000}/api-docs
  `);
}
bootstrap();
