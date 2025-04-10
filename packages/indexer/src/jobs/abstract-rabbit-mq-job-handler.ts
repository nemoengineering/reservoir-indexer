/* eslint-disable @typescript-eslint/no-explicit-any */

// Abstract class needed to be implemented in order to process job from rabbit
import { RabbitMq, RabbitMQMessage } from "@/common/rabbit-mq";
import { logger } from "@/common/logger";
import _ from "lodash";
import { ConsumeMessage } from "amqplib";
import { extendLock, redlock, releaseLock } from "@/common/redis";
import { ChannelWrapper } from "amqp-connection-manager";
import { config } from "@/config/index";
import { sha256 } from "@/common/utils";
import cron from "node-cron";

export type BackoffStrategy =
  | {
      type: "exponential";
      delay: number;
    }
  | {
      type: "fixed";
      delay: number;
    }
  | null;

export type QueueType = "classic" | "quorum";

export abstract class AbstractRabbitMqJobHandler {
  static defaultMaxDeadLetterQueue = 50000;

  abstract queueName: string;
  abstract maxRetries: number;

  public abstract process(payload: any): Promise<any>;

  protected rabbitMqMessage: RabbitMQMessage | undefined; // Hold the rabbitmq message type with all the extra fields
  protected concurrency = 1;
  protected maxDeadLetterQueue = AbstractRabbitMqJobHandler.defaultMaxDeadLetterQueue;
  protected backoff: BackoffStrategy = null;
  protected singleActiveConsumer: boolean | undefined;
  protected persistent = true;
  protected useSharedChannel = false;
  protected lazyMode = false; // Relevant only for classic queues
  protected queueType: QueueType = "quorum";
  protected timeout = 0; // Job timeout in ms
  protected consumerTimeout = 0; // Rabbitmq timeout in ms default to 1800000ms (30 min) increase only if the job needs to run more than that, this value shouldn't be smaller than `timeout` (expect 0)
  protected disableConsuming = config.rabbitDisableQueuesConsuming;
  protected disableErrorLogs = false; // Will disable any error logs resulted from retry unless max retries reached and msg goes to dead letter
  protected priorityQueue = false;
  protected enableFailedJobsRetry = false;
  protected useBackfillRabbit = false; // If true will use the rabbit configured at RABBIT_HOSTNAME_BACKFILL

  public async consume(channel: ChannelWrapper, consumeMessage: ConsumeMessage): Promise<void> {
    try {
      this.rabbitMqMessage = JSON.parse(consumeMessage.content.toString()) as RabbitMQMessage;
    } catch (error) {
      // Log the error
      logger.error(
        this.queueName,
        `Error parsing JSON: ${JSON.stringify(
          error
        )}, queueName=${this.getQueue()}, payload=${JSON.stringify(this.rabbitMqMessage)}`
      );

      channel.ack(consumeMessage);
      return;
    }

    if (consumeMessage.fields.redelivered) {
      logger.info(
        this.queueName,
        JSON.stringify({
          message: `redelivered message payload=${JSON.stringify(this.rabbitMqMessage)}`,
          queue: this.queueName,
          correlationId: this.rabbitMqMessage.correlationId,
        })
      );
    }

    if (this.rabbitMqMessage.jobId) {
      try {
        await extendLock(
          this.rabbitMqMessage.jobId,
          _.max([_.toInteger(this.getTimeout() / 1000), 0]) || 5 * 60
        );
      } catch {
        logger.warn(
          "rabbit-debug",
          `failed to release lock ${this.queueName} ${this.rabbitMqMessage.jobId}`
        );
        // Ignore errors
      }
    }

    const currentTime = _.now();
    this.rabbitMqMessage.lastConsumedTime = currentTime;
    this.rabbitMqMessage.consumedTime = this.rabbitMqMessage.consumedTime ?? currentTime;
    this.rabbitMqMessage.retryCount = this.rabbitMqMessage.retryCount ?? 0;
    let intervalId;

    try {
      let processResult;
      if (this.getTimeout()) {
        let timeout;

        processResult = await Promise.race([
          this.rabbitMqMessage.retryCount > this.maxRetries
            ? this.processDeadLetter(this.rabbitMqMessage.payload)
            : this.process(this.rabbitMqMessage.payload),
          new Promise((resolve, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error(
                    `job timed out ${
                      this.getTimeout() / 1000
                    }s ${this.getQueue()} with payload ${consumeMessage.content.toString()}`
                  )
                ),
              this.getTimeout()
            );
          }),
        ]);

        if (intervalId) {
          clearInterval(intervalId);
        }

        if (timeout) {
          clearTimeout(timeout);
        }
      } else {
        processResult =
          this.rabbitMqMessage.retryCount > this.maxRetries
            ? await this.processDeadLetter(this.rabbitMqMessage.payload)
            : await this.process(this.rabbitMqMessage.payload); // Process the message
      }

      channel.ack(consumeMessage); // Ack the message with rabbit

      this.rabbitMqMessage.completeTime = _.now(); // Set the complete time

      // Release lock if there's a job id
      if (this.rabbitMqMessage.jobId) {
        try {
          await releaseLock(this.rabbitMqMessage.jobId);
        } catch {
          // Ignore errors
        }
      }

      try {
        await this.onCompleted(this.rabbitMqMessage, processResult);
      } catch {
        // Ignore errors
      }
    } catch (error) {
      if (intervalId) {
        clearInterval(intervalId);
      }

      try {
        await this.onError(this.rabbitMqMessage, error);
      } catch {
        // Ignore errors
      }

      this.rabbitMqMessage.retryCount += 1;
      let queueName = this.getQueue();

      // Set the backoff strategy delay
      let delay = this.getBackoffDelay(this.rabbitMqMessage);

      if (
        consumeMessage.properties.headers &&
        Number(consumeMessage.properties.headers["x-delivery-count"]) > this.maxRetries
      ) {
        logger.warn(
          this.queueName,
          JSON.stringify({
            topic: "rabbitmq",
            message: `Message is being re-queued by rabbit x-delivery-count=${Number(
              consumeMessage.properties.headers["x-delivery-count"]
            )} error=${error}`,
            rabbitMqMessage: this.rabbitMqMessage,
            error,
          })
        );
      }

      // If the job has already been retried maxRetries times, send it to the dead letter queue
      const sendToDeadLetter = this.rabbitMqMessage.retryCount > this.maxRetries;

      // Log the error
      if (!this.disableErrorLogs && !sendToDeadLetter) {
        Error.stackTraceLimit = 50;
        logger.warn(
          this.queueName,
          JSON.stringify({
            topic: "rabbitmq",
            message: `Error handling event - Retrying. error=${error}`,
            rabbitMqMessage: this.rabbitMqMessage,
            error,
          })
        );
      }

      if (sendToDeadLetter) {
        logger.error(
          this.queueName,
          JSON.stringify({
            topic: "rabbitmq",
            message: `Error handling event - Sending to dead letter queue. error=${error}`,
            rabbitMqMessage: this.rabbitMqMessage,
            queueMaxRetries: this.maxRetries,
            error,
          })
        );
      }

      try {
        channel.ack(consumeMessage); // Ack the message with rabbit

        // Release lock if there's a job id
        if (this.rabbitMqMessage.jobId) {
          try {
            await releaseLock(this.rabbitMqMessage.jobId);
          } catch {
            // Ignore errors
          }
        }

        if (sendToDeadLetter) {
          queueName = this.getDeadLetterQueue(); // Set the queue to be sent to the dead letter one
          delay = 0; // If sent to dead letter do it w/o delay
          this.rabbitMqMessage.jobId = undefined; // Once sent to dead letter no need for lock
        }

        await RabbitMq.send(queueName, this, this.rabbitMqMessage, delay); // Trigger the retry / or send to dead letter queue
      } catch (error) {
        // Log the error
        logger.error(
          this.queueName,
          `Error handling catch: ${JSON.stringify(
            error
          )}, queueName=${queueName}, payload=${JSON.stringify(this.rabbitMqMessage)}, retryCount=${
            this.rabbitMqMessage.retryCount
          }`
        );
      }
    }
  }

  // Some queue need special handling of dead letter messages in that case this function can be overwritten
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async processDeadLetter(payload: any) {
    return this.process(payload);
  }

  // Function to handle on completed event
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async onCompleted(message: RabbitMQMessage, processResult: any) {
    return;
  }

  // Function to handle on error event
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async onError(message: RabbitMQMessage, error: any) {
    return;
  }

  public getBackoffDelay(message: RabbitMQMessage) {
    let delay = 0;
    if (this.backoff) {
      switch (this.backoff.type) {
        case "fixed":
          delay = this.backoff.delay;
          break;

        case "exponential":
          delay = (2 ^ (Number(message.retryCount) - 1)) * this.backoff.delay;
          break;
      }
    }

    return delay;
  }

  public getQueue(): string {
    return `${this.queueName}`;
  }

  public getPriorityQueue(): string {
    return `${this.getQueue()}-priority`;
  }

  public getDeadLetterQueue(): string {
    return `${this.getQueue()}-dead-letter`;
  }

  public getConcurrency(): number {
    return this.concurrency;
  }

  public getMaxDeadLetterQueue(): number {
    return this.maxDeadLetterQueue;
  }

  public getUseSharedChannel(): boolean {
    return this.useSharedChannel;
  }

  public isLazyMode(): boolean {
    return this.lazyMode;
  }

  public isDisableConsuming(): boolean {
    return this.disableConsuming;
  }

  public isPriorityQueue(): boolean {
    return this.priorityQueue;
  }

  public isUsingBackfillRabbit(): boolean {
    return this.useBackfillRabbit;
  }

  public getSingleActiveConsumer(): boolean | undefined {
    return this.singleActiveConsumer ? this.singleActiveConsumer : undefined;
  }

  public getBackoff(): BackoffStrategy {
    return this.backoff;
  }

  public getQueueType(): QueueType {
    return this.queueType;
  }

  public getConsumerTimeout(): number {
    return this.consumerTimeout;
  }

  public getTimeout(): number {
    return this.timeout;
  }

  public async retryFailedJobs() {
    if (config.doBackgroundWork && this.enableFailedJobsRetry) {
      const jobsIndex = await import("@/jobs/index");

      cron.schedule(
        "*/10 * * * *",
        async () =>
          await redlock
            .acquire([`${this.getQueue()}-failed-jobs-retry-lock`], (10 * 60 - 5) * 1000)
            .then(async () => {
              await jobsIndex.RabbitMqJobsConsumer.retryQueue(this.getQueue());
            })
            .catch(() => {
              // Skip any errors
            })
      );
    }
  }

  protected async send(job: { payload?: any; jobId?: string } = {}, delay = 0, priority = 0) {
    await RabbitMq.send(
      priority ? this.getPriorityQueue() : this.getQueue(),
      this,
      {
        payload: job.payload,
        jobId: job?.jobId ? `${this.queueName}:${job?.jobId}` : undefined,
        persistent: this.persistent,
      },
      delay,
      priority
    );
  }

  protected async sendBatch(
    jobs: { payload: any; jobId?: string; delay?: number; priority?: number }[]
  ) {
    const messages = [];
    const prioritizedMessages = [];

    for (const job of jobs) {
      const message = {
        content: {
          payload: job.payload,
          jobId: job?.jobId ? `${this.queueName}:${job?.jobId}` : undefined,
          persistent: this.persistent,
        },
        delay: job.delay,
        priority: job.priority,
      };

      job.priority ? prioritizedMessages.push(message) : messages.push(message);
    }

    if (!_.isEmpty(messages)) {
      await RabbitMq.sendBatch(this.getQueue(), this, messages);
    }

    if (!_.isEmpty(prioritizedMessages)) {
      await RabbitMq.sendBatch(this.getPriorityQueue(), this, prioritizedMessages);
    }
  }

  public getHash(): string {
    return sha256(
      [
        this.getQueue(),
        this.getQueueType(),
        this.getSingleActiveConsumer(),
        this.getPriorityQueue(),
        this.isPriorityQueue(),
        this.getDeadLetterQueue(),
        this.isLazyMode(),
        this.getConsumerTimeout(),
        this.isUsingBackfillRabbit(),
      ].join("-")
    );
  }
}
