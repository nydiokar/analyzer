import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QueueNames, QueueConfigs } from '../config/queue.config';
import { generateJobId } from '../utils/job-id-generator';

export interface MintParticipantsJobData {
  mint: string;
  cutoffTs: number;
  signature?: string;
}

@Injectable()
export class MintParticipantsJobsQueue {
  private readonly queue: Queue;
  static JOB_NAME = 'mint-participants-run';

  constructor() {
    const config = QueueConfigs[QueueNames.ANALYSIS_OPERATIONS];
    this.queue = new Queue(QueueNames.ANALYSIS_OPERATIONS, config.queueOptions);
  }

  async enqueueRun(data: MintParticipantsJobData, opts?: { priority?: number; delay?: number }) {
    const id = generateJobId.analyzeBehavior(`${data.mint}:${data.cutoffTs}`, data.signature);
    return await this.queue.add(MintParticipantsJobsQueue.JOB_NAME, data, {
      jobId: id,
      removeOnComplete: 50,
      removeOnFail: 100,
      attempts: 2,
      priority: opts?.priority ?? 7,
      delay: opts?.delay,
    });
  }
}


