import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export interface RequestContext {
  requestId: string;
  correlationId: string;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<Result>(context: RequestContext, callback: () => Result): Result {
    return this.storage.run(context, callback);
  }

  get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  getRequestId(): string | undefined {
    return this.get()?.requestId;
  }

  getCorrelationId(): string | undefined {
    return this.get()?.correlationId;
  }
}
