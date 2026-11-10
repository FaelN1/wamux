/**
 * Carregamento das libs do zapo.
 *
 * Diferente do Baileys v7 (ESM-only, que exige o truque do `new Function` em
 * `baileys-runtime.ts`), `zapo-js` e os pacotes `@zapo-js/*` publicam condição
 * `require` no `exports` — o import estático do TS (compilado para `require`
 * no bundle CommonJS da API) funciona direto.
 *
 * Os OPCIONAIS são a exceção e são resolvidos de forma TOLERANTE: cada um
 * arrasta binário nativo (`@roamhq/wrtc` no VoIP, libvips via `sharp` no
 * processador de mídia) ou está em versão inicial (`@zapo-js/wam` v0.1.x).
 * Numa plataforma sem binário publicado o `require` estoura — e derrubar a API
 * inteira por causa de um extra seria pior do que degradar a engine. Cada
 * loader devolve `null` no lugar e o adapter ajusta as capabilities.
 */
import type { voipPlugin as VoipPluginFn } from '@zapo-js/voip';

export type ZapoModule = typeof import('zapo-js');
export type ZapoVoipModule = typeof import('@zapo-js/voip');
export type ZapoMediaUtilsModule = typeof import('@zapo-js/media-utils');
export type ZapoWamModule = typeof import('@zapo-js/wam');

/** `undefined` = ainda não tentou; `null` = tentou e não está disponível. */
let voipModule: ZapoVoipModule | null | undefined;
let mediaModule: ZapoMediaUtilsModule | null | undefined;
let wamModule: ZapoWamModule | null | undefined;

/**
 * `require` dinâmico dentro de try/catch. Um import estático seria içado para
 * o topo do módulo, onde o erro não é capturável.
 */
function tryRequire<T>(specifier: string): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(specifier) as T;
  } catch {
    return null;
  }
}

/**
 * Resolve `@zapo-js/voip`. `null` quando o binário nativo do `@roamhq/wrtc`
 * não existe para esta plataforma/arquitetura.
 */
export function loadZapoVoip(): ZapoVoipModule | null {
  if (voipModule === undefined) voipModule = tryRequire<ZapoVoipModule>('@zapo-js/voip');
  return voipModule;
}

/** `true` quando a engine consegue oferecer chamadas de voz neste host. */
export function isVoipAvailable(): boolean {
  return loadZapoVoip() !== null;
}

/**
 * Resolve `@zapo-js/media-utils` (sharp + file-type + ffmpeg/ffprobe).
 *
 * Sem ele o zapo NÃO detecta mimetype por magic bytes e o builder **lança**
 * para image/video/audio/document/ptv sem `mimetype` explícito — além de subir
 * a mídia sem thumbnail, dimensões nem waveform (chega como anexo simples).
 * Por isso o adapter mantém fallbacks de mimetype para quando ele falta.
 */
export function loadZapoMediaUtils(): ZapoMediaUtilsModule | null {
  if (mediaModule === undefined)
    mediaModule = tryRequire<ZapoMediaUtilsModule>('@zapo-js/media-utils');
  return mediaModule;
}

/** `true` quando há processador de mídia (thumbnail/waveform/detecção de mime). */
export function isMediaProcessorAvailable(): boolean {
  return loadZapoMediaUtils() !== null;
}

/**
 * Resolve `@zapo-js/wam` — telemetria `w:stats` que um WhatsApp Web real emite
 * após o login. É PARIDADE DE FOOTPRINT (anti-fingerprinting), não
 * observabilidade nossa: não é necessário para enviar/receber nada.
 */
export function loadZapoWam(): ZapoWamModule | null {
  if (wamModule === undefined) wamModule = tryRequire<ZapoWamModule>('@zapo-js/wam');
  return wamModule;
}

export type VoipPlugin = ReturnType<typeof VoipPluginFn>;
