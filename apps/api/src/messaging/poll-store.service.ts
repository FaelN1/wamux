import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { PollResults, PollVoteUpdate } from '@wamux/shared';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Agregação de votos de enquete. Guarda os metadados no envio e, a
 * cada voto, o estado ATUAL do votante (voto substitutivo). Redis dá
 * durabilidade + consulta entre workers.
 */
@Injectable()
export class PollStore {
  private readonly ttlSec = 60 * 60 * 24 * 30; // 30 dias

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private metaKey(instanceId: string, pollId: string): string {
    return `poll:${instanceId}:${pollId}:meta`;
  }
  private votesKey(instanceId: string, pollId: string): string {
    return `poll:${instanceId}:${pollId}:votes`;
  }

  async register(instanceId: string, pollId: string, question: string, options: string[]): Promise<void> {
    const key = this.metaKey(instanceId, pollId);
    await this.redis.multi().set(key, JSON.stringify({ question, options })).expire(key, this.ttlSec).exec();
  }

  async applyVote(v: PollVoteUpdate): Promise<void> {
    const key = this.votesKey(v.instanceId, v.pollId);
    await this.redis
      .multi()
      .hset(key, v.voter, JSON.stringify(v.selectedOptions))
      .expire(key, this.ttlSec)
      .exec();
  }

  async results(instanceId: string, pollId: string): Promise<PollResults | null> {
    const rawMeta = await this.redis.get(this.metaKey(instanceId, pollId));
    if (!rawMeta) return null;
    const { question, options } = JSON.parse(rawMeta) as { question: string; options: string[] };

    const byVoter = await this.redis.hgetall(this.votesKey(instanceId, pollId));
    const tally = new Map<string, string[]>(options.map((o) => [o, []]));
    for (const [voter, rawSel] of Object.entries(byVoter)) {
      for (const opt of JSON.parse(rawSel) as string[]) {
        tally.get(opt)?.push(voter);
      }
    }
    return {
      pollId,
      question,
      options: options.map((name) => ({
        name,
        votes: tally.get(name)!.length,
        voters: tally.get(name)!,
      })),
      totalVoters: Object.keys(byVoter).length,
    };
  }
}
