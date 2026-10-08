import { ContractEventRecord } from '../types.js';
import { pool } from '../../db/index.js';
import { eventIndexer } from '../worker.js';

/**
 * Handles operator registration and updates
 */
export async function handleOperatorRegistered(event: ContractEventRecord): Promise<void> {
  const operatorAddress = event.topic[1];
  const value = event.value || {};
  const name = value.name || 'Unknown Operator';
  const payoutAddress = value.payout_address || operatorAddress;

  await pool.query(
    `INSERT INTO operators (operator_address, name, payout_address, is_active, updated_at)
     VALUES ($1, $2, $3, TRUE, CURRENT_TIMESTAMP)
     ON CONFLICT (operator_address) DO UPDATE SET
       name = EXCLUDED.name,
       payout_address = EXCLUDED.payout_address,
       updated_at = CURRENT_TIMESTAMP`,
    [operatorAddress, name, payoutAddress]
  );
  console.log(`[Indexer] Synced operator registration: ${operatorAddress} (${name})`);
}

export async function handleOperatorStatus(event: ContractEventRecord): Promise<void> {
  const operatorAddress = event.topic[1];
  const isActive = Boolean(event.value?.is_active ?? true);

  await pool.query(
    `UPDATE operators SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE operator_address = $2`,
    [isActive, operatorAddress]
  );
}

export async function handleOperatorPayout(event: ContractEventRecord): Promise<void> {
  const operatorAddress = event.topic[1];
  const payoutAddress = event.value?.payout_address || event.topic[2];

  await pool.query(
    `UPDATE operators SET payout_address = $1, updated_at = CURRENT_TIMESTAMP WHERE operator_address = $2`,
    [payoutAddress, operatorAddress]
  );
}

/**
 * Handles plan creation and status changes
 */
export async function handlePlanCreated(event: ContractEventRecord): Promise<void> {
  const operatorAddress = event.topic[1];
  const planId = BigInt(event.topic[2] ?? 0);
  const value = event.value || {};

  const name = value.name || `Plan #${planId}`;
  const token = value.token || 'unknown';
  const deposit = BigInt(value.deposit_amount ?? 0);
  const cashPrice = BigInt(value.total_cash_price ?? 0);
  const dailyRate = BigInt(value.daily_rate ?? 0);

  // Ensure operator exists
  await pool.query(
    `INSERT INTO operators (operator_address, name, payout_address)
     VALUES ($1, 'Operator', $1)
     ON CONFLICT (operator_address) DO NOTHING`,
    [operatorAddress]
  );

  await pool.query(
    `INSERT INTO plans (plan_id, operator_address, name, token_address, deposit_amount, total_cash_price, daily_rate, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
     ON CONFLICT (plan_id) DO UPDATE SET
       name = EXCLUDED.name,
       deposit_amount = EXCLUDED.deposit_amount,
       total_cash_price = EXCLUDED.total_cash_price,
       daily_rate = EXCLUDED.daily_rate`,
    [planId.toString(), operatorAddress, name, token, deposit.toString(), cashPrice.toString(), dailyRate.toString()]
  );
  console.log(`[Indexer] Synced plan creation: #${planId} (${name})`);
}

export async function handlePlanStatus(event: ContractEventRecord): Promise<void> {
  const planId = BigInt(event.topic[1] ?? 0);
  const isActive = Boolean(event.value?.is_active ?? true);

  await pool.query(
    `UPDATE plans SET is_active = $1 WHERE plan_id = $2`,
    [isActive, planId.toString()]
  );
}

// Register with eventIndexer
export function registerOperatorPlanHandlers(): void {
  eventIndexer.registerHandler('op_reg', handleOperatorRegistered);
  eventIndexer.registerHandler('op_act', handleOperatorStatus);
  eventIndexer.registerHandler('op_pay', handleOperatorPayout);
  eventIndexer.registerHandler('pln_crt', handlePlanCreated);
  eventIndexer.registerHandler('pln_act', handlePlanStatus);
}
