import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MEDIA_STORE } from './media-store.interface';
import { LocalMediaStore } from './stores/local-media.store';
import { MediaService } from './media.service';

/**
 * Pipeline de mídia. @Global: InstanceManager (ingestão) e
 * MessagingService (saída) injetam o MediaService sem ciclo. O MediaController
 * é registrado no InstanceModule (onde o guard de apikey já vive).
 * MEDIA_STORE = local por padrão (S3 é plugável depois).
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
        return new LocalMediaStore(dir, base);
      },
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
