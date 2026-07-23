import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { MEDIA_SEARCH_TERMS, MaturationMediaType } from '@wamux/shared';

/** Uma mídia pronta para enviar por URL (o engine/sidecar busca a URL). */
export interface StockMedia {
  type: MaturationMediaType;
  url: string;
  mimetype: string;
}

interface CacheEntry {
  urls: StockMedia[];
  at: number;
}

/** Cache das buscas por (tipo:termo) — reduz chamadas e imita reencaminho. */
const CACHE_TTL_MS = 60 * 60_000;
/** Timeout curto: se o Pexels demorar, cai pra texto sem travar o turno. */
const HTTP_TIMEOUT_MS = 8_000;

/**
 * Busca mídia de stock grátis (Pexels) para o motor de maturação variar as
 * conversas com foto/vídeo. Repassamos a URL pública direta — o engine
 * (Baileys) ou o sidecar (whatsmeow) busca a URL por conta própria, sem
 * download no gateway. Sem chave, `enabled` é false e o motor manda texto.
 */
@Injectable()
export class MaturationMediaService {
  private readonly logger = new Logger(MaturationMediaService.name);
  private readonly apiKey: string;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('maturation.pexelsApiKey') ?? '';
    if (!this.apiKey) {
      this.logger.log('PEXELS_API_KEY ausente — maturação enviará só texto/enquete/localização.');
    }
  }

  /** Há provedor de mídia configurado? */
  get enabled(): boolean {
    return !!this.apiKey;
  }

  /**
   * Uma mídia aleatória do tipo pedido (ou `null` se indisponível). Nunca
   * lança — qualquer falha vira `null` e o motor segue com texto.
   */
  async random(type: MaturationMediaType): Promise<StockMedia | null> {
    if (!this.apiKey) return null;
    const term = this.pick(MEDIA_SEARCH_TERMS);
    try {
      const pool = await this.search(type, term);
      return pool.length ? this.pick(pool) : null;
    } catch (err) {
      this.logger.warn(`Pexels (${type}/${term}) falhou: ${(err as Error).message}`);
      return null;
    }
  }

  /** Busca (com cache) a lista de URLs de um tipo+termo. */
  private async search(type: MaturationMediaType, term: string): Promise<StockMedia[]> {
    const key = `${type}:${term}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.urls;

    const urls = type === 'image' ? await this.searchPhotos(term) : await this.searchVideos(term);
    this.cache.set(key, { urls, at: Date.now() });
    return urls;
  }

  private async searchPhotos(term: string): Promise<StockMedia[]> {
    const res = await axios.get('https://api.pexels.com/v1/search', {
      headers: { Authorization: this.apiKey },
      params: { query: term, per_page: 15, orientation: 'portrait' },
      timeout: HTTP_TIMEOUT_MS,
    });
    const photos = (res.data?.photos ?? []) as Array<{ src?: Record<string, string> }>;
    return photos
      .map((p) => p.src?.large ?? p.src?.medium)
      .filter((u): u is string => !!u)
      .map((url) => ({ type: 'image' as const, url, mimetype: 'image/jpeg' }));
  }

  private async searchVideos(term: string): Promise<StockMedia[]> {
    const res = await axios.get('https://api.pexels.com/videos/search', {
      headers: { Authorization: this.apiKey },
      params: { query: term, per_page: 10, orientation: 'portrait', size: 'small' },
      timeout: HTTP_TIMEOUT_MS,
    });
    const videos = (res.data?.videos ?? []) as Array<{
      video_files?: Array<{ link: string; width: number; file_type: string }>;
    }>;
    const out: StockMedia[] = [];
    for (const v of videos) {
      // menor arquivo mp4 acima de 360px de largura — leve o suficiente para
      // o WhatsApp, mas não pixelado.
      const file = (v.video_files ?? [])
        .filter((f) => f.file_type === 'video/mp4' && f.width >= 360)
        .sort((a, b) => a.width - b.width)[0];
      if (file) out.push({ type: 'video', url: file.link, mimetype: 'video/mp4' });
    }
    return out;
  }

  private pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }
}
