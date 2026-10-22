import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { correlationId } from './common/correlation-id.middleware';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { corsOrigin } from './common/public-url';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  // Frontends on other domains: list them in CORS_ORIGINS (localhost is always allowed for dev).
  app.enableCors({ origin: corsOrigin, credentials: true });
  app.use(correlationId);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder().setTitle('Delivez Core API').setVersion('0.1.0').addBearerAuth().build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  Logger.log(`Delivez Core API on http://localhost:${port}/v1 - docs at http://localhost:${port}/docs`, 'Bootstrap');
}
bootstrap();
