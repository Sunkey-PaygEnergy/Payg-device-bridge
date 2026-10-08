import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../../db/index.js';

export async function financierRoutes(server: FastifyInstance): Promise<void> {
  /**
   * Portfolio summary for a specific financier pool
   */
  server.get(
    '/pools/:poolId',
    async (request: FastifyRequest<{ Params: { poolId: string } }>, reply: FastifyReply) => {
      const { poolId } = request.params;

      const summaryRes = await pool.query(
        `SELECT 
          COUNT(l.lease_id) as total_financed_leases,
          COUNT(CASE WHEN l.status = 'Owned' THEN 1 END) as paid_off_count,
          COUNT(CASE WHEN l.status = 'Active' THEN 1 END) as active_count,
          COUNT(CASE WHEN l.status = 'Repossessed' THEN 1 END) as repossessed_count,
          SUM(l.total_paid) as total_revenue_collected,
          SUM(p.total_cash_price) as total_originated_principal,
          COUNT(CASE WHEN l.paid_until < EXTRACT(EPOCH FROM NOW()) - 2592000 AND l.status != 'Owned' THEN 1 END) as default_count
         FROM leases l
         JOIN plans p ON p.plan_id = l.plan_id
         WHERE l.pool_id = $1`,
        [poolId]
      );

      const stats = summaryRes.rows[0];
      const totalOriginated = BigInt(stats.total_originated_principal || '0');
      const totalCollected = BigInt(stats.total_revenue_collected || '0');
      const recoveryRate =
        totalOriginated > 0n ? Math.round((Number(totalCollected) / Number(totalOriginated)) * 10000) / 100 : 0;

      return reply.send({
        poolId,
        timestamp: new Date(),
        portfolioMetrics: {
          totalFinancedLeases: parseInt(stats.total_financed_leases || '0', 10),
          activeCount: parseInt(stats.active_count || '0', 10),
          paidOffOwnedCount: parseInt(stats.paid_off_count || '0', 10),
          repossessedCount: parseInt(stats.repossessed_count || '0', 10),
          defaultCount30d: parseInt(stats.default_count || '0', 10),
          totalOriginatedPrincipal: totalOriginated.toString(),
          totalRevenueCollected: totalCollected.toString(),
          portfolioRecoveryRatePercent: recoveryRate,
        },
      });
    }
  );

  /**
   * List all leases financed under this pool
   */
  server.get(
    '/pools/:poolId/leases',
    async (
      request: FastifyRequest<{ Params: { poolId: string }; Querystring: { page?: string; limit?: string } }>,
      reply: FastifyReply
    ) => {
      const { poolId } = request.params;
      const { page = '1', limit = '20' } = request.query;
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

      const res = await pool.query(
        `SELECT l.lease_id, l.device_id, l.customer_address, l.status, l.total_paid, l.paid_until,
                p.total_cash_price, p.daily_rate, d.device_model, d.last_sync_status
         FROM leases l
         JOIN plans p ON p.plan_id = l.plan_id
         LEFT JOIN devices d ON d.device_id = l.device_id
         WHERE l.pool_id = $1
         ORDER BY l.created_at DESC
         LIMIT $2 OFFSET $3`,
        [poolId, parseInt(limit, 10), offset]
      );

      return reply.send({
        poolId,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        leases: res.rows,
      });
    }
  );

  /**
   * Query immutable audit trail for financiers and regulators
   */
  server.get('/audit-trail', async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const limit = parseInt(request.query.limit || '50', 10);

    const res = await pool.query(
      `SELECT id, actor_address, action, target_type, target_id, details, created_at
       FROM audit_logs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return reply.send({
      count: res.rows.length,
      logs: res.rows,
    });
  });
}
