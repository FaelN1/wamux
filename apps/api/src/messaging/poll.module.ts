import { Global, Module } from '@nestjs/common';
import { PollStore } from './poll-store.service';

/**
 * PollStore é @Global: o MessagingService registra/consulta enquetes e o
 * InstanceManagerService aplica os votos — sem acoplar os dois módulos.
 */
@Global()
@Module({
  providers: [PollStore],
  exports: [PollStore],
})
export class PollModule {}
