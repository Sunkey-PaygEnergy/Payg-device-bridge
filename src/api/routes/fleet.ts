import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/index.js';
import { DeviceHmacSecurity } from '../../security/hmac.js';

export async function fleetRoutes(server: FastifyInstance): Promise<void> {
  /**
   * Overall fleet health and operational metrics
   */
  server.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const countsRes = await pool.query(`
      SELECT 
        COUNT(*) as total_devices,
        COUNT(CASE WHEN last_sync_status = 'unlocked' THEN 1 END) as active_unlocked,
        COUNT(CASE WHEN last_sync_status = 'locked' THEN 1 END) as locked,
        COUNT(CASE WHEN last_sync_status = 'owned' THEN 1 END) as fully_owned,
        COUNT(CASE WHEN last_seen_at < NOW() - INTERVAL '24 hours' OR last_seen_at IS NULL THEN 1 END) as offline_24h
      FROM devices
    `);

    const telemetryAvg = await pool.query(`
      SELECT 
        AVG(battery_voltage_mv) as avg_battery_mv,
        AVG(solar_input_mv) as avg_solar_mv,
        SUM(energy_generated_wh) as total_wh_generated,
        COUNT(CASE WHEN tamper_flag = true THEN 1 END) as tamper_alerts
      FROM device_telemetry
      WHERE recorded_at >= NOW() - INTERVAL '24 hours'
    `);

    const counts = countsRes.rows[0];
    const avg = telemetryAvg.rows[0];

    return reply.send({
      timestamp: new Date(),
      fleet: {
        totalDevices: parseInt(counts.total_devices, 10),
        activeUnlocked: parseInt(counts.active_unlocked, 10),
        locked: parseInt(counts.locked, 10),
        fullyOwned: parseInt(counts.fully_owned, 10),
        offline24h: parseInt(counts.offline_24h, 10),
      },
      averages24h: {
        averageBatteryVoltageMv: Math.round(avg.avg_battery_mv || 12500),
        averageSolarInputMv: Math.round(avg.avg_solar_mv || 18000),
        totalEnergyGeneratedWh: Math.round(avg.total_wh_generated || 0),
        tamperAlerts: parseInt(avg.tamper_alerts || '0', 10),
      },
    });
  });

  /**
   * Query devices list with status and pagination filters
   */
  server.get(
    '/devices',
    async (
      request: FastifyRequest<{
        Querystring: { status?: string; hardwareType?: string; page?: string; limit?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { status, hardwareType, page = '1', limit = '20' } = request.query;
      const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

      const conditions: string[] = [];
      const params: any[] = [];

      if (status) {
        params.push(status);
        conditions.push(`d.last_sync_status = $${params.length}`);
      }
      if (hardwareType) {
        params.push(hardwareType);
        conditions.push(`d.hardware_type = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const query = `
        SELECT d.device_id, d.operator_address, d.device_model, d.hardware_type, 
               d.last_sync_status, d.last_seen_at, l.lease_id, l.status as lease_status
        FROM devices d
        LEFT JOIN leases l ON l.device_id = d.device_id
        ${whereClause}
        ORDER BY d.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;

      params.push(parseInt(limit, 10), offset);
      const res = await pool.query(query, params);

      return reply.send({
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        data: res.rows,
      });
    }
  );

  /**
   * Historical telemetry logs for a specific device
   */
  server.get(
    '/devices/:deviceId/telemetry',
    async (
      request: FastifyRequest<{ Params: { deviceId: string }; Querystring: { limit?: string } }>,
      reply: FastifyReply
    ) => {
      const { deviceId } = request.params;
      const limit = parseInt(request.query.limit || '50', 10);

      const res = await pool.query(
        `SELECT id, battery_voltage_mv, solar_input_mv, output_current_ma, 
                energy_generated_wh, relay_state, tamper_flag, recorded_at
         FROM device_telemetry
         WHERE device_id = $1
         ORDER BY recorded_at DESC
         LIMIT $2`,
        [deviceId, limit]
      );

      return reply.send({
        deviceId,
        count: res.rows.length,
        telemetry: res.rows,
      });
    }
  );

  /**
   * Ingest device telemetry via HTTP REST with HMAC validation
   */
  server.post(
    '/devices/:deviceId/telemetry',
    async (
      request: FastifyRequest<{
        Params: { deviceId: string };
        Body: {
          timestamp: number;
          batteryVoltageMv?: number;
          solarInputMv?: number;
          outputCurrentMa?: number;
          energyGeneratedWh?: number;
          relayState: boolean;
          tamperFlag?: boolean;
          signature?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { deviceId } = request.params;
      const body = request.body;

      // Fetch secret key for verification
      const devRes = await pool.query('SELECT openpaygo_secret_key FROM devices WHERE device_id = $1', [deviceId]);
      if (devRes.rows.length === 0) {
        return reply.status(404).send({ error: `Device ${deviceId} not found` });
      }

      const secretKey = devRes.rows[0].openpaygo_secret_key;

      if (body.signature) {
        const { signature, ...payloadWithoutSig } = body;
        const validation = DeviceHmacSecurity.validateTelemetryPacket(payloadWithoutSig, signature, secretKey);
        if (!validation.valid) {
          return reply.status(401).send({ error: 'Telemetry authentication failed', reason: validation.reason });
        }
      }

      await pool.query(
        `INSERT INTO device_telemetry 
         (device_id, battery_voltage_mv, solar_input_mv, output_current_ma, energy_generated_wh, relay_state, tamper_flag, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [
          deviceId,
          body.batteryVoltageMv || 12600,
          body.solarInputMv || 18500,
          body.outputCurrentMa || 1200,
          body.energyGeneratedWh || 0,
          body.relayState,
          Boolean(body.tamperFlag),
        ]
      );

      // Update last seen
      await pool.query('UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP WHERE device_id = $1', [deviceId]);

      return reply.status(201).send({ success: true, deviceId, recordedAt: new Date() });
    }
  );
}
