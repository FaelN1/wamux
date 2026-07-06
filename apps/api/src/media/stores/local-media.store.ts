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

  /** URL servível: o MediaController lê inbound/<id>/<messageId>. */
  private url(key: string): string {
    const m = key.match(/^inbound\/([^/]+)\/(.+)$/);
    if (m) return `${this.publicBaseUrl}/api/v1/messages/${m[1]}/media/${m[2]}`;
    return `${this.publicBaseUrl}/api/v1/media/${encodeURIComponent(key)}`;
  }

  async put(key: string, body: Buffer, _opts?: PutOptions): Promise<{ url: string; size: number }> {
    const p = this.path(key);
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, body);
    return { url: this.url(key), size: body.byteLength };
  }

  async putStream(
    key: string,
    body: Readable,
    _opts?: PutOptions,
  ): Promise<{ url: string; size: number }> {
    const p = this.path(key);
    await fs.mkdir(dirname(p), { recursive: true });
    let size = 0;
    body.on('data', (c: Buffer) => (size += c.length));
    await pipeline(body, createWriteStream(p));
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
      return { size: st.size };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.path(key), { force: true });
  }

  /** Diretório base — exposto para o join de chaves em testes. */
  keyPath(...parts: string[]): string {
    return join(...parts);
  }
}
