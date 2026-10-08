import { Worker, Job } from 'bullmq';
import { QUEUE_NAMES, redisConnection, paymentProcessingQueue } from '../queue/index.js';
import { IncomingPaymentEvent, PaymentProcessingResult } from './types.js';
import { pool } from '../db/index.js';
import { sorobanClient } from '../contracts/client.js';
import { commandDispatcher } from '../sync/dispatcher.js';
import { config } from '../config/index.js';
import crypto from 'crypto';

export class PaymentProcessor {
  private worker?: Worker;

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    this.worker = new Worker<IncomingPaymentEvent, PaymentProcessingResult>(
      QUEUE_NAMES.PAYMENT_PROCESSING,
      async (job: Job<IncomingPaymentEvent>) => {
        return await this.processPayment(job.data);
      },
      {
        connection: redisConnection,
        concurrency: 5,
      }
    );

    this.worker.on('failed', (job, err) => {
      console.error(`[PaymentProcessor] Job ${job?.id} failed for lease ${job?.data.leaseId}:`, err.message);
    });
  }

  /**
   * Enqueues an incoming payment event with idempotency deduplication
   */
  public async enqueuePayment(event: IncomingPaymentEvent): Promise<string> {
    const job = await paymentProcessingQueue.add('process-payment', event, {
      jobId: `payment-${event.idempotencyKey}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });
    return job.id ?? event.idempotencyKey;
  }

  /**
   * Processes the payment event, guards idempotency, and submits on-chain pay()
   */
  public async processPayment(event: IncomingPaymentEvent): Promise<PaymentProcessingResult> {
    const { idempotencyKey, leaseId, tokenAmount, source, providerReference } = event;

    // 1. Check idempotency: avoid duplicate payments
    const checkRes = await pool.query<{ id: string; status: string; stellar_tx_hash: string }>(
      'SELECT id, status, stellar_tx_hash FROM transactions WHERE stellar_tx_hash = $1',
      [idempotencyKey]
    );

    if (checkRes.rows.length > 0) {
      console.log(`[PaymentProcessor] Duplicate payment detected for key: ${idempotencyKey}`);
      return {
        success: true,
        idempotencyKey,
        leaseId,
        stellarTxHash: checkRes.rows[0].stellar_tx_hash,
        status: 'DUPLICATE',
        processedAt: new Date(),
      };
    }

    // 2. Fetch lease and device
    const leaseRes = await pool.query<{ device_id: string; customer_address: string }>(
      'SELECT device_id, customer_address FROM leases WHERE lease_id = $1',
      [leaseId.toString()]
    );

    if (leaseRes.rows.length === 0) {
      throw new Error(`Lease not found: ${leaseId}`);
    }

    const { device_id: deviceId, customer_address: customerAddress } = leaseRes.rows[0];

    // 3. Submit pay() transaction to Soroban
    let stellarTxHash = `tx_${crypto.randomBytes(16).toString('hex')}`;
    let success = true;

    if (config.BRIDGE_OPERATOR_SECRET_KEY && config.NODE_ENV === 'production') {
      try {
        const txRes = await sorobanClient.submitPay(
          config.BRIDGE_OPERATOR_SECRET_KEY,
          leaseId,
          tokenAmount
        );
        stellarTxHash = txRes.txHash;
      } catch (submitErr) {
        console.error(`[PaymentProcessor] Error submitting on-chain pay():`, (submitErr as Error).message);
        throw submitErr;
      }
    }

    // 4. Record transaction in database
    await pool.query(
      `INSERT INTO transactions (lease_id, payer_address, amount, stellar_tx_hash, source, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'confirmed', CURRENT_TIMESTAMP)`,
      [leaseId.toString(), customerAddress, tokenAmount.toString(), stellarTxHash, source]
    );

    // 5. Trigger immediate device hardware unlock sync
    if (deviceId) {
      await commandDispatcher.dispatchSync(deviceId, leaseId.toString(), 'payment');
    }

    return {
      success: true,
      idempotencyKey,
      leaseId,
      stellarTxHash,
      status: 'CONFIRMED',
      processedAt: new Date(),
    };
  }

  public async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}

export const paymentProcessor = new PaymentProcessor();
