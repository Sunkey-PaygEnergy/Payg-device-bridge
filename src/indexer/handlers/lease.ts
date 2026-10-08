import { ContractEventRecord } from '../types.js';
import { pool } from '../../db/index.js';
import { eventIndexer } from '../worker.js';

export async function handleLeaseCreated(event: ContractEventRecord): Promise<void> {
  const operatorAddress = event.topic[1];
  const customerAddress = event.topic[2];
  const leaseId = BigInt(event.topic[3] ?? 0);
  const value = event.value || {};

  const planId = BigInt(value.plan_id ?? 0);
  const poolId = value.pool_id ? BigInt(value.pool_id) : null;

  // Insert or update lease record
  await pool.query(
    `INSERT INTO leases (lease_id, customer_address, plan_id, pool_id, status, total_paid, paid_until, deposit_paid, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'PendingDeposit', 0, 0, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (lease_id) DO UPDATE SET
       customer_address = EXCLUDED.customer_address,
       plan_id = EXCLUDED.plan_id,
       pool_id = EXCLUDED.pool_id,
       updated_at = CURRENT_TIMESTAMP`,
    [leaseId.toString(), customerAddress, planId.toString(), poolId ? poolId.toString() : null]
  );
  console.log(`[Indexer] Synced lease creation: #${leaseId} for customer ${customerAddress}`);
}

export async function handleCustomerTransferred(event: ContractEventRecord): Promise<void> {
  const leaseId = BigInt(event.topic[1] ?? 0);
  const newCustomer = event.topic[3] || event.value?.new_customer;

  if (newCustomer) {
    await pool.query(
      `UPDATE leases SET customer_address = $1, updated_at = CURRENT_TIMESTAMP WHERE lease_id = $2`,
      [newCustomer, leaseId.toString()]
    );
    console.log(`[Indexer] Synced lease #${leaseId} customer transfer to: ${newCustomer}`);
  }
}

export async function handleDeviceSwapped(event: ContractEventRecord): Promise<void> {
  const leaseId = BigInt(event.topic[1] ?? 0);
  console.log(`[Indexer] Hardware swap recorded for lease #${leaseId}`);
}

export function registerLeaseHandlers(): void {
  eventIndexer.registerHandler('lse_crt', handleLeaseCreated);
  eventIndexer.registerHandler('lse_xfr', handleCustomerTransferred);
  eventIndexer.registerHandler('dev_swap', handleDeviceSwapped);
}
