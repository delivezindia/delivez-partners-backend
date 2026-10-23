import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { correlationId } from './common/correlation-id.middleware';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { corsOrigin } from './common/public-url';
import { docsBasicAuth, docsMode, DOCS_PATHS } from './common/docs-auth';
import { BUILD } from './common/version';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  // Frontends on other domains: list them in CORS_ORIGINS (localhost is always allowed for dev).
  app.enableCors({ origin: corsOrigin, credentials: true });
  app.use(correlationId);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  // API docs: open in dev; on live servers only behind DOCS_USERNAME / DOCS_PASSWORD, otherwise not served.
  const docs = docsMode();
  if (docs === 'password') app.use(DOCS_PATHS, docsBasicAuth(process.env.DOCS_USERNAME!, process.env.DOCS_PASSWORD!));
  if (docs !== 'off') {
    const swagger = new DocumentBuilder().setTitle('Delivez Core API').setVersion(BUILD.version).addBearerAuth().build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
  }

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  const docsNote = docs === 'off' ? 'docs off (set DOCS_USERNAME and DOCS_PASSWORD to enable)' : `docs at /docs${docs === 'password' ? ' (password protected)' : ''}`;
  Logger.log(`Delivez Core API on http://localhost:${port}/v1 - ${docsNote}`, 'Bootstrap');
}
bootstrap();
