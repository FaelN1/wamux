import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { GlobalApiKeyGuard } from '../common/guards/global-api-key.guard';
import { MediaService } from './media.service';

/** Teto do upload em memória (multer) — espelha MEDIA_MAX_SIZE_MB (default 100). */
const MAX_UPLOAD_BYTES = (Number(process.env.MEDIA_MAX_SIZE_MB) || 100) * 1024 * 1024;

/** Forma mínima do arquivo entregue pelo multer (memoryStorage). */
interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

function mediaTypeFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

/**
 * Upload de mídia (multipart) — escopo ADMIN (GLOBAL_API_KEY). Sobe o arquivo
 * pro store e devolve uma URL pública servível, pronta pra ser usada como
 * `media.url` de qualquer envio. Assim a mídia sobe UMA vez
 * e é referenciada por URL, sem trafegar base64 no config a cada envio.
 */
@ApiTags('Mídia')
@ApiSecurity('apikey')
@Controller('media')
@UseGuards(GlobalApiKeyGuard)
export class MediaUploadController {
  constructor(private readonly media: MediaService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Sobe um arquivo de mídia (multipart) e devolve uma URL pública servível.',
    description:
      'Campo `file` (multipart/form-data). A URL retornada é servida sem apikey ' +
      '(a mesma rota que o engine baixa) e pode ir direto em `media.url` de um envio.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL pública servível da mídia' },
        type: { type: 'string', enum: ['image', 'video', 'audio', 'document'] },
        mimetype: { type: 'string' },
        filename: { type: 'string' },
        size: { type: 'number' },
      },
    },
  })
  async upload(@UploadedFile() file?: MulterFile): Promise<{
    url: string;
    type: 'image' | 'video' | 'audio' | 'document';
    mimetype: string;
    filename: string;
    size: number;
  }> {
    if (!file?.buffer?.byteLength) {
      throw new BadRequestException('Envie um arquivo no campo "file".');
    }
    const out = await this.media.uploadOutbound(file.buffer, file.mimetype);
    return {
      url: out.url,
      type: mediaTypeFromMime(file.mimetype),
      mimetype: out.mimetype ?? file.mimetype,
      filename: file.originalname,
      size: out.size,
    };
  }
}
