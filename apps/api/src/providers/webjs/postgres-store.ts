import { readFile, writeFile } from 'node:fs/promises';
import { SessionStore } from '../provider.types';

/**
 * Store para o `RemoteAuth` do whatsapp-web.js apoiado no nosso `SessionStore`
 * (Postgres). O wwebjs zipa a sessão do Chromium em `${session}.zip` no disco e
 * chama `save`; nós lemos esse zip e persistimos (base64) no Postgres. Na
 * restauração, `extract` grava o zip de volta no disco para o wwebjs descompactar.
 *
 * É isto que faz a sessão do webjs sobreviver a restart/redeploy sem reparear —
 * substituindo o `LocalAuth` (que dependia do disco local efêmero do container).
 */
export class PostgresRemoteStore {
  private readonly key = 'webjs_session_zip';

  constructor(
    private readonly sessionStore: SessionStore,
    private readonly instanceId: string,
  ) {}

  async sessionExists(_options: { session: string }): Promise<boolean> {
    return (await this.sessionStore.get(this.instanceId, this.key)) != null;
  }

  async save(options: { session: string }): Promise<void> {
    const zip = await readFile(`${options.session}.zip`);
    await this.sessionStore.set(this.instanceId, this.key, zip.toString('base64'));
  }

  async extract(options: { session: string; path: string }): Promise<void> {
    const b64 = await this.sessionStore.get(this.instanceId, this.key);
    if (b64) {
      await writeFile(options.path, Buffer.from(b64, 'base64'));
    }
  }

  async delete(_options: { session: string }): Promise<void> {
    await this.sessionStore.remove(this.instanceId, this.key);
  }
}
