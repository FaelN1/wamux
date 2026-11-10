/**
 * Baileys v7 é **ESM-only** (`"type": "module"`), mas a API (NestJS) compila
 * para CommonJS. Um `require('baileys')` falharia em runtime, e o TS converteria
 * um `import()` estático em `require()`. A solução: um dynamic import "de
 * verdade" criado via `new Function`, que o TS não toca — o Node executa o
 * `import()` nativo e carrega o módulo ESM a partir do código CJS.
 */
export type BaileysModule = typeof import('baileys');

// `import(specifier)` aqui é avaliado pelo Node (não pelo TS) → import ESM real.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<BaileysModule>;

let cached: BaileysModule | undefined;

/** Carrega (e cacheia) o módulo `baileys`. */
export async function loadBaileys(): Promise<BaileysModule> {
  if (!cached) {
    cached = await dynamicImport('baileys');
  }
  return cached;
}

export type WaWebVersion = [number, number, number];

/** Logger mínimo — evita acoplar este módulo ao Logger do Nest. */
interface VersionLogger {
  log(message: string): void;
  warn(message: string): void;
}

/**
 * TTL do cache de versão. O WhatsApp publica um build novo a cada poucos dias;
 * 6h mantém a versão fresca sem bater na rede a cada spawn de instância.
 */
const VERSION_TTL_MS = 6 * 60 * 60 * 1000;

let versionCache: { value: WaWebVersion; at: number } | undefined;
/** Dedup de chamadas concorrentes: N instâncias subindo juntas → 1 fetch só. */
let versionInFlight: Promise<WaWebVersion | undefined> | undefined;

/**
 * Resolve a versão do WA Web a passar para o `makeWASocket`.
 *
 * A ordem importa. `fetchLatestBaileysVersion()` faz scrape do
 * `src/Defaults/index.ts` no master do Baileys — ou seja, depende de alguém ter
 * feito o bump lá. Quando essa versão atrasa, o servidor do WhatsApp responde
 * **405** e o pareamento de dispositivo falha com "Couldn't link device"
 * (upstream #2679). Por isso tentamos primeiro `fetchLatestWaWebVersion()`, que
 * lê a versão real do build servido em web.whatsapp.com.
 *
 * Se os dois falharem devolvemos `undefined` e o Baileys usa a versão embutida
 * no pacote — aceitável a partir do rc14, cujo default já é recente.
 */
export async function resolveWaWebVersion(
  logger: VersionLogger,
): Promise<WaWebVersion | undefined> {
  if (versionCache && Date.now() - versionCache.at < VERSION_TTL_MS) {
    return versionCache.value;
  }

  // Uma resolução concorrente já está em andamento — aguarda a mesma promise.
  if (versionInFlight) return versionInFlight;

  versionInFlight = (async (): Promise<WaWebVersion | undefined> => {
    const B = await loadBaileys();

    const sources: Array<[string, () => Promise<{ version: WaWebVersion }>]> = [
      ['web.whatsapp.com', () => B.fetchLatestWaWebVersion({})],
      ['Baileys master', () => B.fetchLatestBaileysVersion()],
    ];

    for (const [origin, fetchVersion] of sources) {
      try {
        const { version } = await fetchVersion();
        if (!Array.isArray(version) || version.length !== 3) continue;
        versionCache = { value: version, at: Date.now() };
        logger.log(`versão do WA Web ${version.join('.')} (via ${origin})`);
        return version;
      } catch (err) {
        logger.warn(`falha ao obter a versão do WA Web via ${origin}: ${(err as Error).message}`);
      }
    }

    // Cache expirado mas sem rede: melhor reusar o último valor bom do que
    // cair no default embutido, que pode estar defasado.
    if (versionCache) {
      logger.warn(`usando a última versão conhecida do WA Web (${versionCache.value.join('.')})`);
      return versionCache.value;
    }

    logger.warn('usando a versão do WA Web embutida no Baileys');
    return undefined;
  })().finally(() => {
    versionInFlight = undefined;
  });

  return versionInFlight;
}
