import { deviceSyncQueue } from '../queue/index.js';
import { DeviceSyncJobData } from './types.js';
import { pool } from '../db/index.js';

export class DeviceCommandDispatcher {
  /**
   * Enqueues a single device state sync job with exponential backoff configuration
   */
  public async dispatchSync(
    deviceId: string,
    leaseId: string,
    trigger: DeviceSyncJobData['trigger'] = 'manual'
  ): Promise<string> {
    const jobId = `sync-${deviceId}-${Date.now()}`;

    const job = await deviceSyncQueue.add(
      'sync-device-state',
      { deviceId, leaseId, trigger },
      {
        jobId,
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 3000,
        },
      }
    );

    return job.id ?? jobId;
  }

  /**
   * Triggers parallel sync for all assigned leases in the operator's fleet
   */
  public async triggerFleetSync(operatorAddress?: string): Promise<{ queuedCount: number }> {
    let sql = `
      SELECT d.device_id, l.lease_id 
      FROM devices d
      JOIN leases l ON l.device_id = d.device_id
      WHERE l.status IN ('Active', 'Suspended', 'PendingDeposit')
    `;
    const params: any[] = [];

    if (operatorAddress) {
      sql += ' AND d.operator_address = $1';
      params.push(operatorAddress);
    }

    const res = await pool.query<{ device_id: string; lease_id: string }>(sql, params);

    for (const row of res.rows) {
      await this.dispatchSync(row.device_id, row.lease_id, 'cron');
    }

    return { queuedCount: res.rows.length };
  }

  /**
   * Record delivery failure and increment retry counter in command logs
   */
  public async handleDeliveryFailure(commandId: string, error: Error): Promise<void> {
    await pool.query(
      `UPDATE device_command_logs 
       SET retry_count = retry_count + 1, 
           error_message = $1, 
           status = CASE WHEN retry_count >= 4 THEN 'FAILED' ELSE 'RETRYING' END 
       WHERE id = $2`,
      [error.message, commandId]
    );
  }

  /**
   * Mark command as acknowledged by hardware
   */
  public async markAcknowledged(commandId: string): Promise<void> {
    await pool.query(
      `UPDATE device_command_logs 
       SET status = 'ACKNOWLEDGED', acknowledged_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [commandId]
    );
  }
}

export const commandDispatcher = new DeviceCommandDispatcher();
