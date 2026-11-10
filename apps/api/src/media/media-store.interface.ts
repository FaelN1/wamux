import { Readable } from 'node:stream';

export const MEDIA_STORE = Symbol('MEDIA_STORE');

export interface PutOptions {
  contentType?: string;
  size?: number;
}
export interface StoredHead {
  contentType?: string;
  size: number;
}

/** Abstração de storage de mídia. O adapter NUNCA fala direto com S3. */
export interface MediaStore {
  put(key: string, body: Buffer, opts?: PutOptions): Promise<{ url: string; size: number }>;
  putStream(key: string, body: Readable, opts?: PutOptions): Promise<{ url: string; size: number }>;
  getStream(key: string): Promise<Readable>;
  getBuffer(key: string): Promise<Buffer>;
  stat(key: string): Promise<StoredHead | null>;
  remove(key: string): Promise<void>;
}
