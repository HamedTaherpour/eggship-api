import type { Job } from 'bullmq';
import type { AsyncJobEnvelope } from '../queue/async-job-context.service';

export interface WorkerProcessor {
  readonly identity?: string;
  queueName: string;
  jobName?: string;
  process(job: Job<AsyncJobEnvelope<unknown>>): Promise<void>;
}
