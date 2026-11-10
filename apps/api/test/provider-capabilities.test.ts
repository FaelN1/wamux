import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ProviderType } from '@wamux/shared';
import { BaileysProvider } from '../src/providers/baileys/baileys.provider';
import { WebjsProvider } from '../src/providers/webjs/webjs.provider';
import { CloudApiProvider } from '../src/providers/cloud/cloud-api.provider';
import { WhatsmeowProvider } from '../src/providers/whatsmeow/whatsmeow.provider';
import { ZapoProvider } from '../src/providers/zapo/zapo.provider';
import type { ProviderContext } from '../src/providers/provider.interface';
import type { WhatsAppProvider } from '../src/providers/provider.interface';

/**
 * Uma capability declarada é uma PROMESSA no contrato: ela sai em
 * `GET /instances/:id/capabilities` e o painel decide o que mostrar a partir
 * dela. Declarar `true` sem implementar o método faz a engine anunciar um
 * recurso que sempre falha — foi exatamente o que aconteceu com
 * `communities` na engine zapo na v2.0.0.
 *
 * Os pares abaixo espelham o guard `requireCapable` de cada feature module
 * (`!capabilities.X || !provider.Y`). Se um módulo novo aparecer com um par
 * novo, acrescente aqui.
 */
const GATES = [
  { capability: 'groups', method: 'listGroups' },
  { capability: 'communities', method: 'listCommunities' },
  { capability: 'newsletter', method: 'listNewsletters' },
  { capability: 'voiceCalls', method: 'startVoiceCall' },
] as const;

/** Contexto mínimo — nenhum adapter faz I/O no construtor. */
function ctx(instanceId: string): ProviderContext {
  return {
    instanceId,
    config: { db: { host: 'localhost', port: 5432, user: 'u', password: 'p', name: 'd' } },
    sessionStore: {
      get: async () => null,
      set: async () => undefined,
      getAll: async () => ({}),
      remove: async () => undefined,
      clear: async () => undefined,
    },
    logger: { log() {}, warn() {}, error() {}, debug() {} } as unknown as ProviderContext['logger'],
  };
}

const ENGINES: Array<{ type: ProviderType; build: () => WhatsAppProvider }> = [
  { type: ProviderType.BAILEYS, build: () => new BaileysProvider(ctx('t-baileys')) },
  { type: ProviderType.WEBJS, build: () => new WebjsProvider(ctx('t-webjs')) },
  { type: ProviderType.CLOUD_API, build: () => new CloudApiProvider(ctx('t-cloud')) },
  { type: ProviderType.WHATSMEOW, build: () => new WhatsmeowProvider(ctx('t-whatsmeow')) },
  { type: ProviderType.ZAPO, build: () => new ZapoProvider(ctx('t-zapo')) },
];

describe('capabilities declaradas x métodos implementados', () => {
  for (const { type, build } of ENGINES) {
    for (const { capability, method } of GATES) {
      it(`${type}: se capabilities.${capability} é true, ${method}() existe`, () => {
        const provider = build();
        const caps = provider.capabilities as Record<string, unknown>;
        if (caps[capability] !== true) return; // não promete nada — nada a cobrar

        assert.equal(
          typeof (provider as unknown as Record<string, unknown>)[method],
          'function',
          `${type} declara ${capability}: true mas não implementa ${method}() — ` +
            `a rota responderia 501 enquanto /capabilities anuncia suporte`,
        );
      });
    }
  }

  it('zapo implementa o contrato de comunidades por inteiro', () => {
    // Guard estreito: a checagem acima só cobre o método que o serviço usa no
    // gate. As demais rotas chamam com `!` e estourariam em runtime.
    const provider = new ZapoProvider(ctx('t-zapo')) as unknown as Record<string, unknown>;
    const required = [
      'listCommunities',
      'communityMetadata',
      'createCommunity',
      'deleteCommunity',
      'updateCommunitySubject',
      'updateCommunityDescription',
      'updateCommunityImage',
      'updateCommunityAdmins',
      'listCommunityMembers',
      'countCommunityMembers',
      'getCommunityInviteCode',
      'revokeCommunityInviteCode',
      'probeCommunityInvite',
      'listCommunityLinkedGroups',
      'linkGroupToCommunity',
      'unlinkGroupFromCommunity',
      'syncCommunity',
      'syncAllCommunities',
    ];
    const faltando = required.filter((m) => typeof provider[m] !== 'function');
    assert.deepEqual(faltando, [], `métodos de comunidade ausentes: ${faltando.join(', ')}`);
  });
});
