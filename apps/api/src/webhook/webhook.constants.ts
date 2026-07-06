import { WebhookEvent } from '@wamux/shared';

export { WebhookEvent };

export const WEBHOOK_QUEUE = 'webhooks';

export interface WebhookJob {
  instanceId: string;
  event: WebhookEvent;
  payload: unknown;
  timestamp: number;
}
