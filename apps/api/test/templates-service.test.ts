import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import type { SendTemplateInput } from '@wamux/shared';
import { TemplatesService } from '../src/templates/templates.service';
import type { FlowSessionService } from '../src/flow-sessions/flow-session.service';
import type { InstanceManagerService } from '../src/instance/instance-manager.service';

function build() {
  const sent: SendTemplateInput[] = [];
  const sessions: unknown[] = [];
  const provider = {
    type: 'cloud',
    capabilities: { templates: true },
    listTemplates: async () => [],
    sendTemplate: async (i: SendTemplateInput) => {
      sent.push(i);
      return { id: 'wamid.T', to: '5511999999999', timestamp: 1, status: 'sent' as const };
    },
  };
  const svc = new TemplatesService(
    { requireLive: async () => provider } as unknown as InstanceManagerService,
    {
      recordSent: async (_id: string, s: unknown) => void sessions.push(s),
    } as unknown as FlowSessionService,
  );
  return { svc, sent, sessions };
}

const base = { to: '5511999999999', name: 'promo', language: 'pt_BR' };

describe('TemplatesService.send', () => {
  it('devolve a rota usada (default cloud)', async () => {
    const t = build();
    assert.equal((await t.svc.send('i1', base)).route, 'cloud');
    assert.equal((await t.svc.send('i1', { ...base, route: 'marketing' })).route, 'marketing');
  });

  it('opções da MM API fora de route=marketing → 400 (não são ignoradas em silêncio)', async () => {
    const t = build();
    await assert.rejects(
      t.svc.send('i1', { ...base, productPolicy: 'STRICT' }),
      BadRequestException,
    );
    await assert.rejects(
      t.svc.send('i1', { ...base, messageActivitySharing: true }),
      BadRequestException,
    );
    assert.equal(t.sent.length, 0);
  });

  it('route=marketing com reply → 400 antes de enviar', async () => {
    const t = build();
    await assert.rejects(
      t.svc.send('i1', { ...base, route: 'marketing', quotedMessageId: 'wamid.X' }),
      BadRequestException,
    );
    assert.equal(t.sent.length, 0);
  });

  it('botão FLOW com flow_token abre a sessão de correlação', async () => {
    const t = build();
    await t.svc.send('i1', {
      ...base,
      components: [
        { type: 'body', parameters: [{ type: 'text', text: 'Maria' }] },
        {
          type: 'button',
          sub_type: 'flow',
          index: '0',
          parameters: [{ type: 'action', action: { flow_token: 'tok-7' } }],
        },
      ],
    });
    assert.deepEqual(t.sessions, [
      {
        flowToken: 'tok-7',
        flowName: 'template:promo',
        contact: '5511999999999',
        messageId: 'wamid.T',
      },
    ]);
  });
});
