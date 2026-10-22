import { Body, Controller, Get, Header, HttpStatus, Param, Put, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { LANGUAGES, load } from '@delivez/i18n';
import { ApiError } from '../../common/api-exception.filter';
import type { ApiRequest, AuthUser } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuditService } from '../../events/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Public } from '../identity/auth.decorators';

const CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];
const languageSchema = z.object({ language: z.enum(CODES) });

/**
 * UI language: the list of languages, the translation bundle per language,
 * and the signed-in user's preferred language (users.language, used by every app).
 */
@ApiTags('i18n')
@Controller()
export class I18nController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('i18n/languages')
  @Header('cache-control', 'public, max-age=3600')
  languages() {
    return LANGUAGES.map((l) => {
      const loaded = load(l.code)!;
      return { code: l.code, locale: l.locale, label: l.label, english: l.english, coverage: loaded.coverage, version: loaded.version };
    });
  }

  /** Translation bundle. Cached by the browser; the version changes whenever the text does. */
  @Public()
  @Get('i18n/:code')
  bundle(@Param('code') code: string, @Req() req: ApiRequest, @Res() res: Response) {
    const lang = load(code);
    if (!lang) throw new ApiError(HttpStatus.NOT_FOUND, 'LANGUAGE_NOT_SUPPORTED', `Supported languages: ${CODES.join(', ')}`);
    const etag = `"${lang.version}"`;
    res.setHeader('etag', etag);
    res.setHeader('cache-control', 'public, max-age=300');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    return res.json({ code: lang.code, locale: lang.locale, version: lang.version, coverage: lang.coverage, messages: lang.messages });
  }

  /** Saves the signed-in user's language so it follows them to every device and app. */
  @ApiBearerAuth()
  @Put('me/language')
  async setLanguage(@Body(new ZodValidationPipe(languageSchema)) body: z.infer<typeof languageSchema>, @CurrentUser() user: AuthUser, @Req() req: ApiRequest) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select: { language: true } });
    if (before.language !== body.language) {
      await this.prisma.user.update({ where: { id: user.userId }, data: { language: body.language as never } });
      await this.audit.log({ actorUserId: user.userId, actorType: 'USER', entity: 'User', entityId: user.userId, action: 'UPDATE', before: { language: before.language }, after: { language: body.language }, ip: req.ip });
    }
    return { language: body.language };
  }
}
