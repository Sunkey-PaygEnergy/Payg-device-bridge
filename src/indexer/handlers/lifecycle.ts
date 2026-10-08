import { ContractEventRecord } from '../types.js';
import { pool } from '../../db/index.js';
import { eventIndexer } from '../worker.js';
import { commandDispatcher } from '../../sync/dispatcher.js';

export async function handleLeaseOwned(event: ContractEventRecord): Promise<void> {
  const leaseId = BigInt(event.topic[1] ?? 0);

  const res = await pool.query<{ device_id: string }>(
    `UPDATE leases 
     SET status = 'Owned', updated_at = CURRENT_TIMESTAMP 
     WHERE lease_id = $1
     RETURNING device_id`,
    [leaseId.toString()]
  );

  console.log(`[Indexer] Lease #${leaseId} reached permanent Owned status!`);

  if (res.rows.length > 0 && res.rows[0].device_id) {
    await commandDispatcher.dispatchSync(res.rows[0].device_id, leaseId.toString(), 'contract_event');
  }
}

export async function handleLeaseSuspension(event: ContractEventRecord): Promise<void> {
  const leaseId = BigInt(event.topic[1] ?? 0);
  const isSuspended = Boolean(event.value?.is_suspended ?? true);
  const newStatus = isSuspended ? 'Suspended' : 'Active';

  const res = await pool.query<{ device_id: string }>(
    `UPDATE leases 
     SET status = $1, updated_at = CURRENT_TIMESTAMP 
     WHERE lease_id = $2
     RETURNING device_id`,
    [newStatus, leaseId.toString()]
  );

  console.log(`[Indexer] Lease #${leaseId} suspension changed: ${newStatus}`);

  if (res.rows.length > 0 && res.rows[0].device_id) {
    await commandDispatcher.dispatchSync(res.rows[0].device_id, leaseId.toString(), 'contract_event');
  }
}

export async function handleLeaseRepossessed(event: ContractEventRecord): Promise<void> {
  const leaseId = BigInt(event.topic[1] ?? 0);

  const res = await pool.query<{ device_id: string }>(
    `UPDATE leases 
     SET status = 'Repossessed', updated_at = CURRENT_TIMESTAMP 
     WHERE lease_id = $1
     RETURNING device_id`,
    [leaseId.toString()]
  );

  console.log(`[Indexer] Lease #${leaseId} REPOSSESSED`);

  if (res.rows.length > 0 && res.rows[0].device_id) {
    await commandDispatcher.dispatchSync(res.rows[0].device_id, leaseId.toString(), 'contract_event');
  }
}

export async function handleEmergencyPause(event: ContractEventRecord): Promise<void> {
  const leaseId = BigInt(event.topic[1] ?? 0);
  const pausedUntil = BigInt(event.value?.paused_until ?? 0);

  const res = await pool.query<{ device_id: string }>(
    `UPDATE leases 
     SET paid_until = $1, status = 'Active', updated_at = CURRENT_TIMESTAMP 
     WHERE lease_id = $2
     RETURNING device_id`,
    [pausedUntil.toString(), leaseId.toString()]
  );

  console.log(`[Indexer] Emergency pause granted on lease #${leaseId} until timestamp: ${pausedUntil}`);

  if (res.rows.length > 0 && res.rows[0].device_id) {
    await commandDispatcher.dispatchSync(res.rows[0].device_id, leaseId.toString(), 'contract_event');
  }
}

export function registerLifecycleHandlers(): void {
  eventIndexer.registerHandler('lse_own', handleLeaseOwned);
  eventIndexer.registerHandler('lse_sus', handleLeaseSuspension);
  eventIndexer.registerHandler('lse_rep', handleLeaseRepossessed);
  eventIndexer.registerHandler('emg_pau', handleEmergencyPause);
}
