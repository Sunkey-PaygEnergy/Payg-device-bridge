import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { mpesaAdapter, mtnAdapter, airtelAdapter } from '../../payments/mobile-money.js';
import { stellarAnchorAdapter } from '../../payments/stellar-anchor.js';
import { paymentProcessor } from '../../payments/processor.js';
import { receiptService } from '../../payments/receipts.js';

export async function paymentRoutes(server: FastifyInstance): Promise<void> {
  /**
   * Safaricom M-Pesa C2B / STK Push Webhook
   */
  server.post('/webhooks/mpesa', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const event = mpesaAdapter.parseWebhook(request.body);
      const jobId = await paymentProcessor.enqueuePayment(event);
      return reply.send({ ResultCode: 0, ResultDesc: 'Accepted', jobId });
    } catch (err) {
      server.log.error(err, 'M-Pesa webhook failed');
      return reply.status(400).send({ ResultCode: 1, ResultDesc: (err as Error).message });
    }
  });

  /**
   * MTN Mobile Money Webhook
   */
  server.post('/webhooks/mtn', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const event = mtnAdapter.parseWebhook(request.body);
      const jobId = await paymentProcessor.enqueuePayment(event);
      return reply.send({ status: 'ACCEPTED', jobId });
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  /**
   * Airtel Money Webhook
   */
  server.post('/webhooks/airtel', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const event = airtelAdapter.parseWebhook(request.body);
      const jobId = await paymentProcessor.enqueuePayment(event);
      return reply.send({ status: 'SUCCESS', jobId });
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  /**
   * Stellar Anchor Deposit Webhook (SEP-24 / SEP-6)
   */
  server.post('/webhooks/stellar-anchor', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const event = stellarAnchorAdapter.parseWebhook(request.body);
      const jobId = await paymentProcessor.enqueuePayment(event);
      return reply.send({ success: true, jobId });
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  /**
   * Generate payment receipt query endpoint
   */
  server.get(
    '/receipts/:leaseId',
    async (
      request: FastifyRequest<{
        Params: { leaseId: string };
        Querystring: { txHash: string; amount: string; fiatAmount?: string; fiatCurrency?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { leaseId } = request.params;
      const { txHash, amount, fiatAmount, fiatCurrency } = request.query;

      if (!txHash || !amount) {
        return reply.status(400).send({ error: 'Missing required query parameters: txHash, amount' });
      }

      const receipt = await receiptService.generateReceipt(
        BigInt(leaseId),
        BigInt(amount),
        txHash,
        fiatAmount ? parseFloat(fiatAmount) : undefined,
        fiatCurrency
      );

      return reply.send(receipt);
    }
  );
}
