import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ProviderType } from '@wamux/shared';
import { BaileysProvider } from '../src/providers/baileys/baileys.provider';
import { CloudApiProvider } from '../src/providers/cloud/cloud-api.provider';
import { WhatsmeowProvider } from '../src/providers/whatsmeow/whatsmeow.provider';
import type { ProviderContext } from '../src/providers/provider.interface';
import type { WhatsAppProvider } from '../src/providers/provider.interface';

/**
 * Uma capability declarada é uma PROMESSA no contrato: ela sai em
 * `GET /instances/:id/capabilities` e o painel decide o que mostrar a partir
 * dela. Declarar `true` sem implementar o método faz a engine anunciar um
 * recurso que sempre falha.
 *
 * Os pares abaixo espelham o guard `requireCapable` de cada feature module
 * (`!capabilities.X || !provider.Y`). Se um módulo novo aparecer com um par
 * novo, acrescente aqui.
 */
const GATES = [
  { capability: 'groups', method: 'listGroups' },
  { capability: 'communities', method: 'listCommunities' },
  { capability: 'newsletter', method: 'listNewsletters' },
] as const;

/** Contexto mínimo — nenhum adapter faz I/O no construtor. */
function ctx(instanceId: string): ProviderContext {
  return {
    instanceId,
    config: {},
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
  { type: ProviderType.CLOUD_API, build: () => new CloudApiProvider(ctx('t-cloud')) },
  { type: ProviderType.WHATSMEOW, build: () => new WhatsmeowProvider(ctx('t-whatsmeow')) },
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

  // Guard estreito: a checagem acima só cobre o método que o serviço usa no
  // gate. As demais rotas chamam com `!` e estourariam em runtime.
  const COMMUNITY_METHODS = [
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
  for (const { type, build } of ENGINES) {
    it(`${type}: se declara communities, implementa o contrato por inteiro`, () => {
      const provider = build() as unknown as Record<string, unknown> & WhatsAppProvider;
      if (provider.capabilities.communities !== true) return;
      const faltando = COMMUNITY_METHODS.filter((m) => typeof provider[m] !== 'function');
      assert.deepEqual(faltando, [], `métodos de comunidade ausentes: ${faltando.join(', ')}`);
    });
  }
});
