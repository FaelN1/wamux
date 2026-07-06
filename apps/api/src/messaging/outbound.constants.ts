import {
  SendButtonsInput,
  SendListInput,
  SendMediaInput,
  SendPixInput,
  SendPollInput,
  SendTextInput,
} from '../providers/provider.types';

export const OUTBOUND_QUEUE = 'messages-out';

export type OutboundKind = 'text' | 'media' | 'poll' | 'buttons' | 'list' | 'pix';

export type OutboundPayload =
  | SendTextInput
  | SendMediaInput
  | SendPollInput
  | SendButtonsInput
  | SendListInput
  | SendPixInput;

export interface OutboundJob {
  instanceId: string;
  kind: OutboundKind;
  payload: OutboundPayload;
  idemKey?: string;
  rate: { capacity: number; refillPerSec: number };
}
