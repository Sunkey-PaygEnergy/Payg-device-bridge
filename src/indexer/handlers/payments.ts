import { ContractEventRecord } from '../types.js';
import { pool } from '../../db/index.js';
import { eventIndexer } from '../worker.js';
import { commandDispatcher } from '../../sync/dispatcher.js';

export async function handlePaymentReceived(event: ContractEventRecord): Promise<void> {
  const payer = event.topic[1];
  const leaseId = BigInt(event.topic[2] ?? 0);
  const value = event.value || {};

  const amount = BigInt(value.amount ?? 0);
  const secondsAdded = BigInt(value.seconds_added ?? 0);
  const newPaidUntil = BigInt(value.new_paid_until ?? 0);
  const newTotalPaid = BigInt(value.new_total_paid ?? 0);

  // 1. Record transaction
  await pool.query(
    `INSERT INTO transactions (lease_id, payer_address, amount, seconds_added, source, status, created_at)
     VALUES ($1, $2, $3, $4, 'stellar_direct', 'confirmed', CURRENT_TIMESTAMP)`,
    [leaseId.toString(), payer, amount.toString(), secondsAdded.toString()]
  );

  // 2. Update lease state
  const leaseUpdate = await pool.query<{ device_id: string }>(
    `UPDATE leases 
     SET total_paid = $1, 
         paid_until = $2, 
         deposit_paid = TRUE, 
         status = 'Active',
         updated_at = CURRENT_TIMESTAMP 
     WHERE lease_id = $3
     RETURNING device_id`,
    [newTotalPaid.toString(), newPaidUntil.toString(), leaseId.toString()]
  );

  console.log(`[Indexer] Synced payment on lease #${leaseId}: amount=${amount}, secondsAdded=${secondsAdded}`);

  // 3. Immediately trigger device hardware unlock sync
  if (leaseUpdate.rows.length > 0 && leaseUpdate.rows[0].device_id) {
    const deviceId = leaseUpdate.rows[0].device_id;
    await commandDispatcher.dispatchSync(deviceId, leaseId.toString(), 'payment');
  }
}

export async function handleCreditGranted(event: ContractEventRecord): Promise<void> {
  const operator = event.topic[1];
  const leaseId = BigInt(event.topic[2] ?? 0);
  const value = event.value || {};

  const secondsAdded = BigInt(value.seconds_added ?? 0);
  const newPaidUntil = BigInt(value.new_paid_until ?? 0);

  // 1. Record transaction
  await pool.query(
    `INSERT INTO transactions (lease_id, payer_address, amount, seconds_added, source, status, created_at)
     VALUES ($1, $2, 0, $3, 'credit_grant', 'confirmed', CURRENT_TIMESTAMP)`,
    [leaseId.toString(), operator, secondsAdded.toString()]
  );

  // 2. Update lease
  const leaseUpdate = await pool.query<{ device_id: string }>(
    `UPDATE leases 
     SET paid_until = $1, 
         status = 'Active', 
         updated_at = CURRENT_TIMESTAMP 
     WHERE lease_id = $2
     RETURNING device_id`,
    [newPaidUntil.toString(), leaseId.toString()]
  );

  console.log(`[Indexer] Synced credit grant on lease #${leaseId}: secondsAdded=${secondsAdded}`);

  // 3. Immediately trigger device hardware unlock sync
  if (leaseUpdate.rows.length > 0 && leaseUpdate.rows[0].device_id) {
    const deviceId = leaseUpdate.rows[0].device_id;
    await commandDispatcher.dispatchSync(deviceId, leaseId.toString(), 'payment');
  }
}

export function registerPaymentHandlers(): void {
  eventIndexer.registerHandler('lse_pay', handlePaymentReceived);
  eventIndexer.registerHandler('crd_grt', handleCreditGranted);
}
