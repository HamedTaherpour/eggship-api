import type { Job } from 'bullmq';
import type { AsyncJobEnvelope } from '../queue/async-job-context.service';

export interface WorkerProcessor {
  queueName: string;
  jobName?: string;
  process(job: Job<AsyncJobEnvelope<unknown>>): Promise<void>;
}
