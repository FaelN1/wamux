import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MEDIA_STORE } from './media-store.interface';
import { LocalMediaStore } from './stores/local-media.store';
import { S3MediaStore } from './stores/s3-media.store';
import { MediaService } from './media.service';

const logger = new Logger('MediaModule');

/**
 * Pipeline de mídia. @Global: InstanceManager (ingestão) e
 * MessagingService (saída) injetam o MediaService sem ciclo. O MediaController
 * é registrado no InstanceModule (onde o guard de apikey já vive).
 * MEDIA_STORE = local por padrão; s3 exige bucket+credenciais — se
 * incompleto, cai pra local (degrada graciosamente, nunca derruba o boot).
 */
@Global()
@Module({
  providers: [
    MediaService,
    {
      provide: MEDIA_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dir = config.get<string>('media.local.dir') ?? './data/media';
        const base = config.get<string>('publicBaseUrl') || 'http://localhost:3000';
        const store = config.get<string>('media.store') ?? 'local';

        if (store === 's3') {
          const bucket = config.get<string>('media.s3.bucket') ?? '';
          const accessKeyId = config.get<string>('media.s3.accessKeyId') ?? '';
          const secretAccessKey = config.get<string>('media.s3.secretAccessKey') ?? '';
          if (bucket && accessKeyId && secretAccessKey) {
            return new S3MediaStore(
              {
                endpoint: config.get<string>('media.s3.endpoint') || undefined,
                region: config.get<string>('media.s3.region') ?? 'us-east-1',
                bucket,
                accessKeyId,
                secretAccessKey,
                forcePathStyle: config.get<boolean>('media.s3.forcePathStyle') ?? true,
              },
              base,
            );
          }
          const missing = [
            !bucket && 'MEDIA_S3_BUCKET',
            !accessKeyId && 'MEDIA_S3_ACCESS_KEY_ID',
            !secretAccessKey && 'MEDIA_S3_SECRET_ACCESS_KEY',
          ]
            .filter(Boolean)
            .join(', ');
          logger.warn(
            `MEDIA_STORE=s3 mas faltam variáveis obrigatórias (${missing}) — caindo pra store local em ${dir}.`,
          );
        }

        return new LocalMediaStore(dir, base);
      },
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
