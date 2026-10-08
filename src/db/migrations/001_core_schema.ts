import { Migration } from '../migrator.js';

export const migration001CoreSchema: Migration = {
  id: '001_core_schema',
  name: 'Create operators, plans, devices, leases, and transactions tables',
  up: `
    CREATE TABLE IF NOT EXISTS operators (
      operator_address VARCHAR(56) PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      contact_info TEXT,
      payout_address VARCHAR(56) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS plans (
      plan_id BIGINT PRIMARY KEY,
      operator_address VARCHAR(56) NOT NULL REFERENCES operators(operator_address),
      name VARCHAR(128) NOT NULL,
      token_address VARCHAR(56) NOT NULL,
      deposit_amount NUMERIC(28, 0) NOT NULL,
      total_cash_price NUMERIC(28, 0) NOT NULL,
      daily_rate NUMERIC(28, 0) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS devices (
      device_id VARCHAR(64) PRIMARY KEY,
      operator_address VARCHAR(56) REFERENCES operators(operator_address),
      device_model VARCHAR(64) NOT NULL,
      hardware_type VARCHAR(32) NOT NULL, -- 'iot_connected' | 'offline_keypad'
      openpaygo_token_count INTEGER NOT NULL DEFAULT 0,
      openpaygo_secret_key VARCHAR(128) NOT NULL,
      firmware_version VARCHAR(32),
      last_sync_status VARCHAR(32) NOT NULL DEFAULT 'locked',
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS leases (
      lease_id BIGINT PRIMARY KEY,
      device_id VARCHAR(64) REFERENCES devices(device_id),
      customer_address VARCHAR(56) NOT NULL,
      customer_phone VARCHAR(32),
      plan_id BIGINT NOT NULL REFERENCES plans(plan_id),
      status VARCHAR(32) NOT NULL DEFAULT 'PendingDeposit',
      total_paid NUMERIC(28, 0) NOT NULL DEFAULT 0,
      paid_until BIGINT NOT NULL DEFAULT 0,
      deposit_paid BOOLEAN NOT NULL DEFAULT FALSE,
      pool_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_leases_device_id ON leases(device_id);
    CREATE INDEX IF NOT EXISTS idx_leases_customer ON leases(customer_address);
    CREATE INDEX IF NOT EXISTS idx_leases_status ON leases(status);

    CREATE TABLE IF NOT EXISTS transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lease_id BIGINT REFERENCES leases(lease_id),
      payer_address VARCHAR(56),
      amount NUMERIC(28, 0) NOT NULL,
      seconds_added BIGINT NOT NULL DEFAULT 0,
      stellar_tx_hash VARCHAR(64) UNIQUE,
      source VARCHAR(32) NOT NULL, -- 'stellar_direct', 'mobile_money', 'credit_grant'
      status VARCHAR(32) NOT NULL DEFAULT 'confirmed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_lease_id ON transactions(lease_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_tx_hash ON transactions(stellar_tx_hash);
  `,
};
