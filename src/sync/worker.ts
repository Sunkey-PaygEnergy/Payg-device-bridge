import { Worker, Job } from 'bullmq';
import { QUEUE_NAMES, redisConnection } from '../queue/index.js';
import { DeviceSyncJobData, SyncResult } from './types.js';
import { pool } from '../db/index.js';
import { sorobanClient } from '../contracts/client.js';
import { adapterRegistry } from '../adapters/registry.js';
import { DeviceInfo } from '../adapters/types.js';
import crypto from 'crypto';

export class DeviceSyncWorker {
  private worker?: Worker;

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    this.worker = new Worker<DeviceSyncJobData, SyncResult>(
      QUEUE_NAMES.DEVICE_SYNC,
      async (job: Job<DeviceSyncJobData>) => {
        return await this.processSync(job.data);
      },
      {
        connection: redisConnection,
        concurrency: 5,
      }
    );

    this.worker.on('failed', (job, err) => {
      console.error(`[DeviceSyncWorker] Job ${job?.id} failed for device ${job?.data.deviceId}:`, err.message);
    });
  }

  public async processSync(data: DeviceSyncJobData): Promise<SyncResult> {
    const { deviceId, leaseId, trigger } = data;

    // 1. Fetch device and lease from DB
    const res = await pool.query(
      `SELECT d.device_id, d.operator_address, d.device_model, d.hardware_type, 
              d.openpaygo_token_count, d.openpaygo_secret_key, d.last_sync_status,
              l.customer_phone, l.status as lease_status
       FROM devices d
       LEFT JOIN leases l ON l.device_id = d.device_id
       WHERE d.device_id = $1`,
      [deviceId]
    );

    if (res.rows.length === 0) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    const row = res.rows[0];
    const deviceInfo: DeviceInfo = {
      deviceId: row.device_id,
      operatorAddress: row.operator_address,
      deviceModel: row.device_model,
      hardwareType: row.hardware_type,
      openpaygoSecretKey: row.openpaygo_secret_key,
      openpaygoTokenCount: row.openpaygo_token_count,
      customerPhone: row.customer_phone,
      lastSyncStatus: row.last_sync_status,
    };

    // 2. Fetch authoritative on-chain state from Soroban
    const access = await sorobanClient.getAccess(BigInt(leaseId));

    // 3. Resolve device adapter
    const adapter = adapterRegistry.getAdapter(deviceInfo.hardwareType, deviceInfo.deviceModel);

    let targetStatus: 'locked' | 'unlocked' | 'owned' = 'locked';
    let commandType: 'LOCK' | 'UNLOCK' | 'PERMANENT_UNLOCK' = 'LOCK';
    let tokenGenerated: string | undefined;

    if (access.is_owned) {
      targetStatus = 'owned';
      commandType = 'PERMANENT_UNLOCK';
      const cmdRes = await adapter.unlockPermanent(deviceInfo);
      tokenGenerated = cmdRes.tokenGenerated;
    } else if (access.is_active && access.seconds_remaining > 0n && !access.is_suspended) {
      targetStatus = 'unlocked';
      commandType = 'UNLOCK';
      const cmdRes = await adapter.unlock(deviceInfo, access.paid_until);
      tokenGenerated = cmdRes.tokenGenerated;
    } else {
      targetStatus = 'locked';
      commandType = 'LOCK';
      await adapter.lock(deviceInfo);
    }

    // 4. Record command log
    const cmdId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO device_command_logs 
       (id, device_id, lease_id, command_type, payload, token_generated, status, dispatched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
      [
        cmdId,
        deviceId,
        leaseId,
        commandType,
        JSON.stringify({ trigger, accessState: { ...access, paid_until: access.paid_until.toString(), seconds_remaining: access.seconds_remaining.toString() } }),
        tokenGenerated ?? null,
        'SENT',
      ]
    );

    // 5. Update device status
    await pool.query(
      `UPDATE devices SET last_sync_status = $1, last_seen_at = CURRENT_TIMESTAMP WHERE device_id = $2`,
      [targetStatus, deviceId]
    );

    return {
      deviceId,
      leaseId,
      previousStatus: deviceInfo.lastSyncStatus,
      newStatus: targetStatus,
      tokenGenerated,
      dispatched: true,
      timestamp: new Date(),
    };
  }

  public async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}

export const deviceSyncWorker = new DeviceSyncWorker();
