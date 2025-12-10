import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS for development
  app.enableCors({
    origin: [
      'http://10.10.2.90:3000', // Added Vercel frontend URL
      'http://localhost:3030', // Local development URL
      'http://localhost:3000', // Local development URL
      'http://localhost:3001', // Local development URL
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
      - GTP (Goods To Person) location management
      - Station management and configuration
      - Product catalog management
      - Inventory tracking and bulk operations
      - License plate to GTP location mapping
      
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
    .addTag('Orders', 'Order management, file uploads, and license plate mapping')
    .addTag('GTP Locations', 'Goods To Person location management and configuration')
    .addTag('Stations', 'Station management and GTP location assignments')
    .addTag('Products', 'Product catalog management')
    .addTag('Inventory', 'Inventory tracking, management, and bulk operations')
    .addTag('Orchestrator', 'Task orchestration and batch processing for warehouse operations')
    .addTag('Webhook', 'Webhook endpoints for receiving status updates from WMS API layer')
    .build();

  const document = SwaggerModule.createDocument(app, config);
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
