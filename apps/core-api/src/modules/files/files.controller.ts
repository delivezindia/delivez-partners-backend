import { Controller, Get, HttpCode, Param, Put, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../identity/auth.decorators';
import { StorageService } from './storage.service';

// The signed token in the query string is the authorisation for both routes.
@ApiTags('files')
@Public()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Put('upload')
  @HttpCode(200)
  async upload(@Query('token') token: string, @Req() req: Request) {
    const { fileKey, size } = await this.storage.writeUpload(token, req.header('content-type'), req);
    return { fileKey, size };
  }

  /** Product images are public (customers see them); only keys under stores/{uuid}/products/ qualify. */
  @Get('public/stores/:storeId/products/:file')
  publicImage(@Param('storeId') storeId: string, @Param('file') file: string, @Res() res: Response) {
    if (!/^[0-9a-f-]{36}$/.test(storeId) || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(file)) {
      res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: 'File not found' } });
      return;
    }
    const f = this.storage.openKey(`stores/${storeId}/products/${file}`);
    res.setHeader('content-type', f.contentType);
    res.setHeader('content-length', String(f.size));
    res.setHeader('cache-control', 'public, max-age=86400, immutable');
    f.stream.pipe(res);
  }

  @Get('raw')
  raw(@Query('token') token: string, @Res() res: Response) {
    const file = this.storage.openRead(token);
    res.setHeader('content-type', file.contentType);
    res.setHeader('content-length', String(file.size));
    res.setHeader('cache-control', 'private, max-age=600');
    file.stream.pipe(res);
  }
}
