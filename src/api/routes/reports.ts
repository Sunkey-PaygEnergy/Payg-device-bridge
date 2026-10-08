import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../../db/index.js';

export async function reportRoutes(server: FastifyInstance): Promise<void> {
  /**
   * Generates cumulative repayment curve vs planned repayment schedule
   */
  server.get(
    '/repayment-curve/:leaseId',
    async (request: FastifyRequest<{ Params: { leaseId: string } }>, reply: FastifyReply) => {
      const { leaseId } = request.params;

      const leaseRes = await pool.query(
        `SELECT l.*, p.total_cash_price, p.daily_rate, p.deposit_amount
         FROM leases l
         JOIN plans p ON p.plan_id = l.plan_id
         WHERE l.lease_id = $1`,
        [leaseId]
      );

      if (leaseRes.rows.length === 0) {
        return reply.status(404).send({ error: `Lease ${leaseId} not found` });
      }

      const lease = leaseRes.rows[0];

      // Fetch all payment events
      const txRes = await pool.query(
        `SELECT amount, created_at, source 
         FROM transactions 
         WHERE lease_id = $1 AND status = 'confirmed' 
         ORDER BY created_at ASC`,
        [leaseId]
      );

      let cumulative = 0n;
      const actualCurve = txRes.rows.map((tx) => {
        cumulative += BigInt(tx.amount);
        return {
          timestamp: tx.created_at,
          amount: tx.amount,
          cumulativePaid: cumulative.toString(),
          source: tx.source,
        };
      });

      const totalCashPrice = BigInt(lease.total_cash_price);
      const percentRepaid =
        totalCashPrice > 0n ? Math.min(100, Math.round((Number(cumulative) / Number(totalCashPrice)) * 10000) / 100) : 0;

      return reply.send({
        leaseId,
        totalCashPrice: totalCashPrice.toString(),
        totalPaid: cumulative.toString(),
        percentRepaid,
        status: lease.status,
        curvePoints: actualCurve,
      });
    }
  );

  /**
   * Export fleet status as CSV
   */
  server.get('/fleet/csv', async (request: FastifyRequest, reply: FastifyReply) => {
    const res = await pool.query(`
      SELECT 
        d.device_id, d.device_model, d.hardware_type, d.last_sync_status,
        l.lease_id, l.customer_address, l.customer_phone, l.status as lease_status,
        l.total_paid, p.total_cash_price, l.paid_until
      FROM devices d
      LEFT JOIN leases l ON l.device_id = d.device_id
      LEFT JOIN plans p ON p.plan_id = l.plan_id
      ORDER BY d.device_id ASC
    `);

    let csv = 'Device ID,Model,Hardware Type,Sync Status,Lease ID,Customer,Phone,Lease Status,Total Paid,Cash Price,Paid Until\n';

    for (const r of res.rows) {
      csv += `"${r.device_id}","${r.device_model}","${r.hardware_type}","${r.last_sync_status}","${r.lease_id || ''}","${r.customer_address || ''}","${r.customer_phone || ''}","${r.lease_status || ''}","${r.total_paid || 0}","${r.total_cash_price || 0}","${r.paid_until || ''}"\n`;
    }

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="sunkey_fleet_report.csv"');
    return reply.send(csv);
  });

  /**
   * Export all transactions as CSV
   */
  server.get('/transactions/csv', async (request: FastifyRequest, reply: FastifyReply) => {
    const res = await pool.query(`
      SELECT id, lease_id, payer_address, amount, seconds_added, source, status, created_at, stellar_tx_hash
      FROM transactions
      ORDER BY created_at DESC
    `);

    let csv = 'ID,Lease ID,Payer,Amount,Seconds Added,Source,Status,Created At,Tx Hash\n';

    for (const r of res.rows) {
      csv += `"${r.id}","${r.lease_id || ''}","${r.payer_address || ''}","${r.amount}","${r.seconds_added || 0}","${r.source}","${r.status}","${r.created_at}","${r.stellar_tx_hash || ''}"\n`;
    }

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="sunkey_transactions_report.csv"');
    return reply.send(csv);
  });
}
