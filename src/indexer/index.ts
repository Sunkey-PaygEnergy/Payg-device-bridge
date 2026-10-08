import { registerOperatorPlanHandlers } from './handlers/operator-plan.js';
import { registerLeaseHandlers } from './handlers/lease.js';
import { registerPaymentHandlers } from './handlers/payments.js';
import { registerLifecycleHandlers } from './handlers/lifecycle.js';

export * from './types.js';
export * from './worker.js';

export function initializeEventHandlers(): void {
  registerOperatorPlanHandlers();
  registerLeaseHandlers();
  registerPaymentHandlers();
  registerLifecycleHandlers();
  console.log('[Indexer] All Soroban smart contract event handlers successfully initialized.');
}
