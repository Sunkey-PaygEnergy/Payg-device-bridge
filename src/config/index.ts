import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Server settings
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // PostgreSQL settings
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/payg_bridge'),
  DB_MAX_CONNECTIONS: z.coerce.number().default(20),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().default(30000),

  // Redis settings
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // Stellar & Soroban settings
  STELLAR_NETWORK_PASSPHRASE: z.string().default('Test SDF Network ; September 2015'),
  STELLAR_RPC_URL: z.string().default('https://soroban-testnet.stellar.org'),
  STELLAR_HORIZON_URL: z.string().default('https://horizon-testnet.stellar.org'),
  CONTRACT_ID: z.string().default('CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'),
  BRIDGE_OPERATOR_SECRET_KEY: z.string().optional(),

  // Device & IoT Protocol settings
  MQTT_BROKER_URL: z.string().default('mqtt://localhost:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_TOPIC_PREFIX: z.string().default('sunkey/devices'),
  DEVICE_COMMAND_TIMEOUT_SECONDS: z.coerce.number().default(30),
  SYNC_INTERVAL_SECONDS: z.coerce.number().default(60),
  RECONCILIATION_INTERVAL_SECONDS: z.coerce.number().default(300),

  // Security & Hardware Key Management
  DEVICE_HMAC_MASTER_KEY: z.string().default('dev-master-secret-key-must-be-32-chars-long!'),
  KMS_PROVIDER: z.enum(['local', 'vault', 'aws-kms']).default('local'),
  INTERNAL_API_KEY: z.string().default('dev-sunkey-internal-api-key-secret'),

  // Mobile Money Provider Webhook Settings
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_CALLBACK_URL: z.string().optional(),
  MTN_SUBSCRIPTION_KEY: z.string().optional(),
  AIRTEL_CLIENT_ID: z.string().optional(),

  // Payment Anchor Currency
  USDC_TOKEN_ADDRESS: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

let parsedConfig: Config;

try {
  parsedConfig = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Invalid configuration environment variables:', error.format());
  }
  // Provide fallback defaults for safe testing
  parsedConfig = envSchema.parse({});
}

export const config = parsedConfig;
export default config;
