import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../../db/index.js';

export async function riskRoutes(server: FastifyInstance): Promise<void> {
  /**
   * List overdue devices with aging buckets
   */
  server.get('/overdue', async (request: FastifyRequest, reply: FastifyReply) => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    const query = `
      SELECT 
        l.lease_id, l.device_id, l.customer_address, l.customer_phone, l.status,
        l.total_paid, l.paid_until, p.daily_rate, p.total_cash_price,
        ROUND(($1 - l.paid_until) / 86400.0, 1) as days_overdue,
        d.last_sync_status, d.device_model
      FROM leases l
      JOIN plans p ON p.plan_id = l.plan_id
      LEFT JOIN devices d ON d.device_id = l.device_id
      WHERE l.status IN ('Active', 'Suspended') 
        AND l.paid_until < $1
        AND l.deposit_paid = TRUE
      ORDER BY days_overdue DESC
    `;

    const res = await pool.query(query, [nowSeconds]);

    // Categorize into aging buckets
    const buckets = {
      bucket1_7Days: [] as any[],
      bucket8_30Days: [] as any[],
      bucket31_90Days: [] as any[],
      bucketOver90Days: [] as any[],
    };

    for (const item of res.rows) {
      const days = parseFloat(item.days_overdue);
      if (days <= 7) buckets.bucket1_7Days.push(item);
      else if (days <= 30) buckets.bucket8_30Days.push(item);
      else if (days <= 90) buckets.bucket31_90Days.push(item);
      else buckets.bucketOver90Days.push(item);
    }

    return reply.send({
      timestamp: new Date(),
      totalOverdueCount: res.rows.length,
      buckets: {
        '1-7_days': { count: buckets.bucket1_7Days.length, leases: buckets.bucket1_7Days },
        '8-30_days': { count: buckets.bucket8_30Days.length, leases: buckets.bucket8_30Days },
        '31-90_days': { count: buckets.bucket31_90Days.length, leases: buckets.bucket31_90Days },
        'over_90_days': { count: buckets.bucketOver90Days.length, leases: buckets.bucketOver90Days },
      },
    });
  });

  /**
   * Portfolio default risk metrics
   */
  server.get('/default-metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    const statsRes = await pool.query(
      `SELECT 
        COUNT(*) as total_leases,
        COUNT(CASE WHEN paid_until < $1 AND status != 'Owned' THEN 1 END) as overdue_leases,
        COUNT(CASE WHEN paid_until < $1 - 2592000 AND status != 'Owned' THEN 1 END) as critical_default_30d,
        COUNT(CASE WHEN status = 'Repossessed' THEN 1 END) as repossessed_count,
        COUNT(CASE WHEN status = 'Owned' THEN 1 END) as owned_count,
        SUM(p.total_cash_price - l.total_paid) as portfolio_outstanding_principal
       FROM leases l
       JOIN plans p ON p.plan_id = l.plan_id
       WHERE l.deposit_paid = TRUE`,
      [nowSeconds]
    );

    const stats = statsRes.rows[0];
    const total = parseInt(stats.total_leases, 10) || 1;
    const critical = parseInt(stats.critical_default_30d, 10) || 0;
    const defaultRate = Math.round((critical / total) * 10000) / 100;

    return reply.send({
      timestamp: new Date(),
      metrics: {
        totalLeases: total,
        overdueCount: parseInt(stats.overdue_leases, 10),
        criticalDefaultCount30d: critical,
        portfolioDefaultRatePercent: defaultRate,
        repossessedCount: parseInt(stats.repossessed_count, 10),
        completedOwnedCount: parseInt(stats.owned_count, 10),
        totalOutstandingPrincipal: stats.portfolio_outstanding_principal || '0',
      },
    });
  });
}
