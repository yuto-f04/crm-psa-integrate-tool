import { context, trace } from "@opentelemetry/api";
import { Queue, QueueEvents, Worker, type JobsOptions, type Processor } from "bullmq";
import IORedis from "ioredis";

export interface QueueConfig {
  prefix?: string;
  connection: string;
  defaultJobOptions?: JobsOptions;
}

export interface JobPayload {
  idempotencyKey?: string;
  [key: string]: unknown;
}

export class QueueManager {
  private readonly tracer = trace.getTracer("packages-queue");
  private readonly redis: IORedis;
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly config: QueueConfig) {
    this.redis = new IORedis(config.connection, {
      lazyConnect: true,
      maxRetriesPerRequest: null
    });
  }

  async connect() {
    if (this.redis.status === "ready") return;
    await this.redis.connect();
  }

  getQueue(name: string): Queue {
    const existing = this.queues.get(name);
    if (existing) {
      return existing;
    }
    const queue = new Queue(name, {
      connection: this.redis,
      prefix: this.config.prefix,
      defaultJobOptions: this.config.defaultJobOptions
    });
    this.queues.set(name, queue);
    return queue;
  }

  async enqueue(name: string, payload: JobPayload, jobOpts: JobsOptions = {}) {
    const queue = this.getQueue(name);
    const span = this.tracer.startSpan(`queue.enqueue.${name}`, {
      attributes: {
        "queue.name": name,
        "job.idempotency": payload.idempotencyKey ?? "none"
      }
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        await queue.add(name, payload, jobOpts);
        span.setAttribute("queue.success", true);
      } catch (error) {
        span.recordException(error as Error);
        span.setAttribute("queue.success", false);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  registerWorker<T extends JobPayload>(
    name: string,
    processor: Processor<T>,
    opts: { concurrency?: number } = {}
  ) {
    const worker = new Worker<T, void>(name, async (job, token) => {
      const span = this.tracer.startSpan(`queue.process.${name}`, {
        attributes: {
          "queue.job.id": job.id,
          "queue.job.attempts": job.attemptsMade
        }
      });

      return context.with(trace.setSpan(context.active(), span), async () => {
        try {
          await processor(job, token);
          span.setAttribute("queue.success", true);
        } catch (error) {
          span.recordException(error as Error);
          span.setAttribute("queue.success", false);
          throw error;
        } finally {
          span.end();
        }
      });
    }, {
      connection: this.redis,
      concurrency: opts.concurrency ?? 5
    });

    return worker;
  }

  attachListeners(queueName: string, events?: Partial<Record<"failed" | "completed", (args: unknown) => void>>) {
    const queueEvents = new QueueEvents(queueName, {
      connection: this.redis
    });
    if (events?.failed) {
      queueEvents.on("failed", events.failed);
    }
    if (events?.completed) {
      queueEvents.on("completed", events.completed);
    }
    return queueEvents;
  }
}

export const createQueueManager = (config: QueueConfig) => new QueueManager(config);
