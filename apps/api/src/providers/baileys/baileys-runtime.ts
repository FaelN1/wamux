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
