import { Migration } from '../migrator.js';

export const migration002CommandsAndTelemetry: Migration = {
  id: '002_commands_and_telemetry',
  name: 'Create device command logs, telemetry, indexer cursors, and audit records',
  up: `
    CREATE TABLE IF NOT EXISTS device_command_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id VARCHAR(64) NOT NULL REFERENCES devices(device_id),
      lease_id BIGINT REFERENCES leases(lease_id),
      command_type VARCHAR(32) NOT NULL, -- 'LOCK', 'UNLOCK', 'EXTEND_TIME', 'SET_FREE_ACCESS', 'SYNC_STATE'
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      token_generated VARCHAR(64),
      status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED'
      dispatched_at TIMESTAMPTZ,
      acknowledged_at TIMESTAMPTZ,
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_cmd_device_id ON device_command_logs(device_id);
    CREATE INDEX IF NOT EXISTS idx_cmd_status ON device_command_logs(status);

    CREATE TABLE IF NOT EXISTS device_telemetry (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id VARCHAR(64) NOT NULL REFERENCES devices(device_id),
      battery_voltage_mv INTEGER,
      solar_input_mv INTEGER,
      output_current_ma INTEGER,
      energy_generated_wh NUMERIC(14, 2),
      relay_state BOOLEAN NOT NULL DEFAULT FALSE,
      tamper_flag BOOLEAN NOT NULL DEFAULT FALSE,
      raw_payload JSONB,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON device_telemetry(device_id, recorded_at DESC);

    CREATE TABLE IF NOT EXISTS indexer_cursors (
      id VARCHAR(64) PRIMARY KEY,
      last_paging_token VARCHAR(128) NOT NULL,
      last_ledger_sequence BIGINT NOT NULL DEFAULT 0,
      last_event_time TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_address VARCHAR(56),
      action VARCHAR(64) NOT NULL,
      target_type VARCHAR(32) NOT NULL,
      target_id VARCHAR(64) NOT NULL,
      details JSONB,
      ip_address VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `,
};
