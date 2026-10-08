import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/index.js';
import { kmsProvider } from '../../security/kms.js';
import { commandDispatcher } from '../../sync/dispatcher.js';

const registerDeviceSchema = z.object({
  deviceId: z.string().min(3).max(64),
  operatorAddress: z.string().min(56).max(56),
  deviceModel: z.string().min(2).max(64),
  hardwareType: z.enum(['iot_connected', 'offline_keypad']),
  firmwareVersion: z.string().optional(),
});

const assignLeaseSchema = z.object({
  leaseId: z.coerce.string(),
  customerPhone: z.string().optional(),
});

export async function deviceRoutes(server: FastifyInstance): Promise<void> {
  /**
   * Register a new solar device into the bridge fleet
   */
  server.post(
    '/',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = registerDeviceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }

      const { deviceId, operatorAddress, deviceModel, hardwareType, firmwareVersion } = parsed.data;

      // Check if device already exists
      const existing = await pool.query('SELECT device_id FROM devices WHERE device_id = $1', [deviceId]);
      if (existing.rows.length > 0) {
        return reply.status(409).send({ error: `Device with ID ${deviceId} already registered` });
      }

      // Derives unique secret key via KMS
      const secretKey = await kmsProvider.deriveDeviceKey(deviceId, operatorAddress);

      await pool.query(
        `INSERT INTO devices 
         (device_id, operator_address, device_model, hardware_type, openpaygo_token_count, openpaygo_secret_key, firmware_version, last_sync_status, created_at)
         VALUES ($1, $2, $3, $4, 0, $5, $6, 'locked', CURRENT_TIMESTAMP)`,
        [deviceId, operatorAddress, deviceModel, hardwareType, secretKey, firmwareVersion || null]
      );

      return reply.status(201).send({
        success: true,
        deviceId,
        operatorAddress,
        deviceModel,
        hardwareType,
        tokenCount: 0,
        status: 'locked',
        createdAt: new Date(),
      });
    }
  );

  /**
   * Link physical device to an active customer lease
   */
  server.post(
    '/:deviceId/assign-lease',
    async (request: FastifyRequest<{ Params: { deviceId: string } }>, reply: FastifyReply) => {
      const { deviceId } = request.params;
      const parsed = assignLeaseSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }

      const { leaseId, customerPhone } = parsed.data;

      // Verify device exists
      const devRes = await pool.query('SELECT device_id FROM devices WHERE device_id = $1', [deviceId]);
      if (devRes.rows.length === 0) {
        return reply.status(404).send({ error: `Device ${deviceId} not found` });
      }

      // Verify lease exists
      const leaseRes = await pool.query('SELECT lease_id, customer_address FROM leases WHERE lease_id = $1', [leaseId]);
      if (leaseRes.rows.length === 0) {
        return reply.status(404).send({ error: `Lease ${leaseId} not found` });
      }

      // Assign device to lease
      await pool.query(
        `UPDATE leases 
         SET device_id = $1, customer_phone = COALESCE($2, customer_phone), updated_at = CURRENT_TIMESTAMP 
         WHERE lease_id = $3`,
        [deviceId, customerPhone || null, leaseId]
      );

      // Audit log
      await pool.query(
        `INSERT INTO audit_logs (action, target_type, target_id, details)
         VALUES ('DEVICE_LEASE_ASSIGNED', 'device', $1, $2)`,
        [deviceId, JSON.stringify({ leaseId, customerPhone })]
      );

      // Trigger state sync
      await commandDispatcher.dispatchSync(deviceId, leaseId, 'manual');

      return reply.send({
        success: true,
        deviceId,
        leaseId,
        message: 'Device successfully bound to lease and sync job queued',
      });
    }
  );

  /**
   * Get device status and assigned lease details
   */
  server.get(
    '/:deviceId',
    async (request: FastifyRequest<{ Params: { deviceId: string } }>, reply: FastifyReply) => {
      const { deviceId } = request.params;

      const res = await pool.query(
        `SELECT d.*, l.lease_id, l.customer_address, l.customer_phone, l.status as lease_status, l.paid_until
         FROM devices d
         LEFT JOIN leases l ON l.device_id = d.device_id
         WHERE d.device_id = $1`,
        [deviceId]
      );

      if (res.rows.length === 0) {
        return reply.status(404).send({ error: `Device ${deviceId} not found` });
      }

      const row = res.rows[0];
      return reply.send({
        deviceId: row.device_id,
        operatorAddress: row.operator_address,
        deviceModel: row.device_model,
        hardwareType: row.hardware_type,
        tokenCount: row.openpaygo_token_count,
        firmwareVersion: row.firmware_version,
        lastSyncStatus: row.last_sync_status,
        lastSeenAt: row.last_seen_at,
        lease: row.lease_id
          ? {
              leaseId: row.lease_id,
              customerAddress: row.customer_address,
              customerPhone: row.customer_phone,
              status: row.lease_status,
              paidUntil: row.paid_until,
            }
          : null,
      });
    }
  );

  /**
   * Request manual immediate synchronization
   */
  server.post(
    '/:deviceId/sync',
    async (request: FastifyRequest<{ Params: { deviceId: string } }>, reply: FastifyReply) => {
      const { deviceId } = request.params;

      const res = await pool.query<{ lease_id: string }>(
        'SELECT lease_id FROM leases WHERE device_id = $1',
        [deviceId]
      );

      if (res.rows.length === 0) {
        return reply.status(404).send({ error: `No lease assigned to device ${deviceId}` });
      }

      const jobId = await commandDispatcher.dispatchSync(deviceId, res.rows[0].lease_id, 'manual');
      return reply.send({ success: true, deviceId, jobId, message: 'Sync command dispatched' });
    }
  );
}
