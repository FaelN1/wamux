import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { MediaStore, PutOptions, StoredHead } from '../media-store.interface';

export interface S3MediaStoreConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

/**
 * Store S3 (ou compatível — MinIO, DigitalOcean Spaces, etc). A URL
 * continua sendo a rota do próprio gateway (não presigned) — mesmo
 * motivo do LocalMediaStore: mediaUrl fica persistida em message_logs
 * a longo prazo, e Baileys busca a URL de saída sem apikey.
 */
export class S3MediaStore implements MediaStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    config: S3MediaStoreConfig,
    private readonly publicBaseUrl: string,
  ) {
    this.bucket = config.bucket;
    const clientConfig: S3ClientConfig = {
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    if (config.endpoint) clientConfig.endpoint = config.endpoint;
    this.client = new S3Client(clientConfig);
  }

  /**
   * URL servível. inbound/<instanceId>/<messageId> → MediaController
   * (guardado por apikey de instância). outbound/<instanceId>/<uuid> →
   * PublicMediaController (SEM guard — o próprio engine, ex. Baileys, busca
   * essa URL via HTTP puro pra relayar ao WhatsApp, então não carrega
   * apikey; a segurança vem do uuid não-adivinhável no path). Verbatim de
   * LocalMediaStore.url() — mesmo shape, só muda onde os bytes vivem.
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

  async put(key: string, body: Buffer, opts?: PutOptions): Promise<{ url: string; size: number }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: opts?.contentType,
      }),
    );
    return { url: this.url(key), size: body.byteLength };
  }

  async putStream(
    key: string,
    body: Readable,
    opts?: PutOptions,
  ): Promise<{ url: string; size: number }> {
    // PutObjectCommand precisa saber o tamanho antecipadamente pra streaming
    // sem buffer completo; sem `opts.size` (ex. chunked do provider),
    // bufferizamos — mais simples e sem dependência extra (lib-storage).
    const buf = await this.streamToBuffer(body);
    return this.put(key, buf, opts);
  }

  async getStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }

  async getBuffer(key: string): Promise<Buffer> {
    const stream = await this.getStream(key);
    return this.streamToBuffer(stream);
  }

  async stat(key: string): Promise<StoredHead | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: head.ContentLength ?? 0, contentType: head.ContentType };
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === 'NotFound' || name === 'NoSuchKey') return null;
      throw e;
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }
}
