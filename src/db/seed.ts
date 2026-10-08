import { migrator } from './migrator.js';
import { pool, closePool } from './index.js';
import { kmsProvider } from '../security/kms.js';

export async function seedDatabase(): Promise<void> {
  console.log('Running database migrations...');
  await migrator.up();
  console.log('Migrations complete. Seeding demo clean energy fleet data...');

  const operatorAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  // 1. Operator
  await pool.query(
    `INSERT INTO operators (operator_address, name, contact_info, payout_address, is_active)
     VALUES ($1, 'Sunkey Clean Energy Ltd', 'support@sunkey-energy.org', $1, TRUE)
     ON CONFLICT (operator_address) DO NOTHING`,
    [operatorAddress]
  );

  // 2. Plans
  await pool.query(
    `INSERT INTO plans (plan_id, operator_address, name, token_address, deposit_amount, total_cash_price, daily_rate, is_active)
     VALUES 
      (1, $1, 'Home Solar 100W (Sinoware / IONA)', 'USDC_TOKEN', 20000000, 150000000, 1000000, TRUE),
      (2, $1, 'Solar Pump System (Lorentz S1-200)', 'USDC_TOKEN', 50000000, 450000000, 2500000, TRUE)
     ON CONFLICT (plan_id) DO NOTHING`,
    [operatorAddress]
  );

  // 3. Certified Devices
  const devices = [
    { id: 'IONA-HM-01', model: 'IONA Home Max', type: 'iot_connected' },
    { id: 'SINOWARE-SHB100-01', model: 'SunHome-Base 100', type: 'offline_keypad' },
    { id: 'VICTRON-SHS200-01', model: 'Victron Energy SHS200', type: 'offline_keypad' },
    { id: 'LORENTZ-S1-01', model: 'Lorentz S1-200 Pump', type: 'iot_connected' },
  ];

  for (const d of devices) {
    const key = await kmsProvider.deriveDeviceKey(d.id, operatorAddress);
    await pool.query(
      `INSERT INTO devices (device_id, operator_address, device_model, hardware_type, openpaygo_token_count, openpaygo_secret_key, last_sync_status)
       VALUES ($1, $2, $3, $4, 1, $5, 'unlocked')
       ON CONFLICT (device_id) DO NOTHING`,
      [d.id, operatorAddress, d.model, d.type, key]
    );
  }

  // 4. Sample Leases
  const now = Math.floor(Date.now() / 1000);
  const paidUntilActive = now + 14 * 86400; // 14 days active access

  await pool.query(
    `INSERT INTO leases (lease_id, device_id, customer_address, customer_phone, plan_id, status, total_paid, paid_until, deposit_paid, pool_id)
     VALUES 
      (101, 'SINOWARE-SHB100-01', 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF', '+254711223344', 1, 'Active', 35000000, $1, TRUE, 1),
      (102, 'IONA-HM-01', 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWHF', '+256788112233', 1, 'Active', 40000000, $1, TRUE, 1)
     ON CONFLICT (lease_id) DO NOTHING`,
    [paidUntilActive]
  );

  console.log('Sample demo fleet seeded successfully!');
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDatabase()
    .then(() => closePool())
    .catch((e) => {
      console.error('Seed error:', e);
      process.exit(1);
    });
}
