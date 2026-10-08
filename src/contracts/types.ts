export type LeaseStatus =
  | 'PendingDeposit'
  | 'Active'
  | 'Suspended'
  | 'Repossessed'
  | 'Owned';

export interface Lease {
  id: bigint;
  operator: string;
  customer: string;
  plan_id: bigint;
  status: LeaseStatus;
  total_paid: bigint;
  paid_until: bigint;
  deposit_paid: boolean;
  pool_id?: bigint | null;
  created_at: bigint;
  last_payment_at: bigint;
}

export interface AccessStatus {
  is_active: boolean;
  paid_until: bigint;
  is_owned: boolean;
  is_suspended: boolean;
  seconds_remaining: bigint;
}

export interface Plan {
  id: bigint;
  operator: string;
  name: string;
  token: string;
  deposit_amount: bigint;
  total_cash_price: bigint;
  daily_rate: bigint;
  is_active: boolean;
}

export interface Operator {
  address: string;
  name: string;
  contact_info: string;
  payout_address: string;
  is_active: boolean;
  created_at: bigint;
}
