import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MaturationService } from './maturation.service';
import {
  MATURATION_QUEUE,
  MaturationAckJob,
  MaturationJob,
  MaturationTurnJob,
} from './maturation.constants';

/**
 * Worker fino da fila de maturação — toda a lógica mora no service.
 * `turn` = um turno de conversa (e agenda o próximo);
 * `ack`  = lado receptor (leitura + reação), segundos após o envio.
 * Ambos são no-throw no service: erro vira evento no feed do plano.
 */
@Processor(MATURATION_QUEUE, { concurrency: 5 })
export class MaturationProcessor extends WorkerHost {
  constructor(private readonly service: MaturationService) {
    super();
  }

  async process(job: Job<MaturationJob>): Promise<void> {
    if (job.name === 'turn') {
      await this.service.runTurn((job.data as MaturationTurnJob).planId);
    } else if (job.name === 'ack') {
      await this.service.runAck(job.data as MaturationAckJob);
    }
  }
}
