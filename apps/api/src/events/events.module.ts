import { Module, forwardRef } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { EventsWsGateway } from './events-ws.gateway';
import { RabbitmqService } from './rabbitmq.service';
import { EventBusService } from './event-bus.service';

/**
 * Transportes de STREAM de eventos (WebSocket + RabbitMQ) e o fan-out
 * (EventBus). Importa o InstanceModule (via forwardRef, pois o manager de lá
 * usa o EventBus daqui) para ler a config de eventos e autenticar o WS.
 */
@Module({
  imports: [forwardRef(() => InstanceModule)],
  providers: [EventsWsGateway, RabbitmqService, EventBusService],
  exports: [EventsWsGateway, RabbitmqService, EventBusService],
})
export class EventsModule {}
