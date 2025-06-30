import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);
    const config = new DocumentBuilder()
    .setTitle('My API')
    .setDescription('API documentation for my application')
    .setVersion('1.0')
   
    .addApiKey(
    {
      type: 'apiKey',
      name: 'authorization', // header key
      in: 'header',
    },
    'api-key', // name to reference in @ApiSecurity
  )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document); 
  await app.listen(process.env.PORT ?? 8000);
}
bootstrap();
