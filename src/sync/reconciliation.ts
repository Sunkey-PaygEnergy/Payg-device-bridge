import { pool } from '../db/index.js';
import { sorobanClient } from '../contracts/client.js';
import { commandDispatcher } from './dispatcher.js';

export interface ReconciliationSummary {
  totalChecked: number;
  inSync: number;
  driftDetected: number;
  remediatedCount: number;
  tamperAlerts: number;
  timestamp: Date;
}

export class DeviceReconciliationService {
  public async runReconciliation(): Promise<ReconciliationSummary> {
    const summary: ReconciliationSummary = {
      totalChecked: 0,
      inSync: 0,
      driftDetected: 0,
      remediatedCount: 0,
      tamperAlerts: 0,
      timestamp: new Date(),
    };

    // Query active and pending leases with assigned hardware
    const query = `
      SELECT d.device_id, d.last_sync_status, l.lease_id, l.status as lease_status,
             dt.relay_state, dt.tamper_flag
      FROM devices d
      JOIN leases l ON l.device_id = d.device_id
      LEFT JOIN LATERAL (
        SELECT relay_state, tamper_flag 
        FROM device_telemetry 
        WHERE device_id = d.device_id 
        ORDER BY recorded_at DESC 
        LIMIT 1
      ) dt ON true
    `;

    const res = await pool.query(query);
    summary.totalChecked = res.rows.length;

    for (const row of res.rows) {
      try {
        const leaseId = row.lease_id;
        const deviceId = row.device_id;
        const lastSyncStatus = row.last_sync_status;

        // Check for hardware tamper alerts from telemetry
        if (row.tamper_flag === true) {
          summary.tamperAlerts++;
          console.warn(`[Reconciliation] TAMPER DETECTED on device: ${deviceId}`);
        }

        // Authoritative on-chain state
        const access = await sorobanClient.getAccess(BigInt(leaseId));

        let expectedStatus: 'locked' | 'unlocked' | 'owned' = 'locked';
        if (access.is_owned) {
          expectedStatus = 'owned';
        } else if (access.is_active && access.seconds_remaining > 0n && !access.is_suspended) {
          expectedStatus = 'unlocked';
        } else {
          expectedStatus = 'locked';
        }

        // Compare expected vs recorded status
        if (lastSyncStatus !== expectedStatus) {
          summary.driftDetected++;
          console.log(
            `[Reconciliation] Drift detected on device ${deviceId}: recorded=${lastSyncStatus}, chainExpected=${expectedStatus}. Remediating...`
          );

          // Dispatch corrective action
          await commandDispatcher.dispatchSync(deviceId, leaseId, 'cron');
          summary.remediatedCount++;
        } else {
          summary.inSync++;
        }
      } catch (err) {
        console.error(`[Reconciliation] Error reconciling device ${row.device_id}:`, (err as Error).message);
      }
    }

    return summary;
  }
}

export const reconciliationService = new DeviceReconciliationService();
