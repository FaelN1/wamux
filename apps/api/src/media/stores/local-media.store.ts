import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MediaStore, PutOptions, StoredHead } from '../media-store.interface';

/**
 * Store local em disco (default dev). Grava por streaming; a URL é a
 * rota do próprio gateway (servida pelo MediaController). Zero dependência
 * externa. O `key` é `inbound/<instanceId>/<messageId>` ou `outbound/...`.
 */
export class LocalMediaStore implements MediaStore {
  constructor(
    private readonly dir: string,
    private readonly publicBaseUrl: string,
  ) {}

  private path(key: string): string {
    // Impede path traversal — resolve dentro do dir base.
    const p = resolve(this.dir, key);
    if (!p.startsWith(resolve(this.dir))) throw new Error('key inválida');
    return p;
  }

  /** Sidecar com o content-type — disco não guarda metadata própria. */
  private metaPath(key: string): string {
    return `${this.path(key)}.meta.json`;
  }

  /**
   * URL servível. inbound/<instanceId>/<messageId> → MediaController
   * (guardado por apikey de instância). outbound/<instanceId>/<uuid> →
   * PublicMediaController (SEM guard — o próprio engine, ex. Baileys, busca
   * essa URL via HTTP puro pra relayar ao WhatsApp, então não carrega
   * apikey; a segurança vem do uuid não-adivinhável no path).
   */
  private url(key: string): string {
    const inboundMatch = key.match(/^inbound\/([^/]+)\/(.+)$/);
    if (inboundMatch)
      return `${this.publicBaseUrl}/api/v1/messages/${inboundMatch[1]}/media/${inboundMatch[2]}`;
    const outboundMatch = key.match(/^outbound\/([^/]+)\/(.+)$/);
    if (outboundMatch)
      return `${this.publicBaseUrl}/api/v1/media/outbound/${outboundMatch[1]}/${outboundMatch[2]}`;
    return `${this.publicBaseUrl}/api/v1/media/${encodeURIComponent(key)}`;
  }

  private async writeMeta(key: string, opts?: PutOptions): Promise<void> {
    if (!opts?.contentType) return;
    await fs.writeFile(this.metaPath(key), JSON.stringify({ contentType: opts.contentType }));
  }

  async put(key: string, body: Buffer, opts?: PutOptions): Promise<{ url: string; size: number }> {
    const p = this.path(key);
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, body);
    await this.writeMeta(key, opts);
    return { url: this.url(key), size: body.byteLength };
  }

  async putStream(
    key: string,
    body: Readable,
    opts?: PutOptions,
  ): Promise<{ url: string; size: number }> {
    const p = this.path(key);
    await fs.mkdir(dirname(p), { recursive: true });
    let size = 0;
    body.on('data', (c: Buffer) => (size += c.length));
    await pipeline(body, createWriteStream(p));
    await this.writeMeta(key, opts);
    return { url: this.url(key), size };
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.path(key));
  }

  async getBuffer(key: string): Promise<Buffer> {
    return fs.readFile(this.path(key));
  }

  async stat(key: string): Promise<StoredHead | null> {
    try {
      const st = await fs.stat(this.path(key));
      let contentType: string | undefined;
      try {
        const raw = await fs.readFile(this.metaPath(key), 'utf-8');
        contentType = JSON.parse(raw).contentType;
      } catch {
        // sem sidecar — content-type desconhecido, tudo bem.
      }
      return { size: st.size, contentType };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.path(key), { force: true });
    await fs.rm(this.metaPath(key), { force: true });
  }

  /** Diretório base — exposto para o join de chaves em testes. */
  keyPath(...parts: string[]): string {
    return join(...parts);
  }
}
