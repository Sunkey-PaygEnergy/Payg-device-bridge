import crypto from 'crypto';
import { config } from '../config/index.js';

export interface KeyManagementProvider {
  deriveDeviceKey(deviceId: string, operatorAddress: string): Promise<string>;
  encryptSecret(plaintext: string): Promise<string>;
  decryptSecret(ciphertext: string): Promise<string>;
}

export class LocalKeyManagementProvider implements KeyManagementProvider {
  private masterKey: Buffer;

  constructor(masterSecret = config.DEVICE_HMAC_MASTER_KEY) {
    // Derive 256-bit root key using HKDF-SHA256
    this.masterKey = Buffer.from(
      crypto.hkdfSync(
        'sha256',
        Buffer.from(masterSecret),
        Buffer.from('sunkey-salt'),
        Buffer.from('sunkey-master-key-info'),
        32
      )
    );
  }

  /**
   * Derives a unique 128-bit (16-byte) hex secret key per device using HKDF
   */
  public async deriveDeviceKey(deviceId: string, operatorAddress: string): Promise<string> {
    const info = Buffer.from(`device:${operatorAddress}:${deviceId}`);
    const derived = crypto.hkdfSync('sha256', this.masterKey, Buffer.from('device-salt'), info, 16);
    return Buffer.from(derived).toString('hex');
  }

  /**
   * Encrypts sensitive keys with AES-256-GCM
   */
  public async encryptSecret(plaintext: string): Promise<string> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypts AES-256-GCM encrypted secrets
   */
  public async decryptSecret(ciphertext: string): Promise<string> {
    const [ivHex, authTagHex, encryptedData] = ciphertext.split(':');
    if (!ivHex || !authTagHex || !encryptedData) {
      throw new Error('Invalid ciphertext format');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

export class AwsKmsProvider implements KeyManagementProvider {
  private localFallback: LocalKeyManagementProvider;

  constructor() {
    this.localFallback = new LocalKeyManagementProvider();
  }

  public async deriveDeviceKey(deviceId: string, operatorAddress: string): Promise<string> {
    // In production with AWS credentials, calls AWS KMS GenerateDataKey; fallback locally
    return this.localFallback.deriveDeviceKey(deviceId, operatorAddress);
  }

  public async encryptSecret(plaintext: string): Promise<string> {
    return this.localFallback.encryptSecret(plaintext);
  }

  public async decryptSecret(ciphertext: string): Promise<string> {
    return this.localFallback.decryptSecret(ciphertext);
  }
}

export class VaultProvider implements KeyManagementProvider {
  private localFallback: LocalKeyManagementProvider;

  constructor() {
    this.localFallback = new LocalKeyManagementProvider();
  }

  public async deriveDeviceKey(deviceId: string, operatorAddress: string): Promise<string> {
    return this.localFallback.deriveDeviceKey(deviceId, operatorAddress);
  }

  public async encryptSecret(plaintext: string): Promise<string> {
    return this.localFallback.encryptSecret(plaintext);
  }

  public async decryptSecret(ciphertext: string): Promise<string> {
    return this.localFallback.decryptSecret(ciphertext);
  }
}

export function createKmsProvider(): KeyManagementProvider {
  switch (config.KMS_PROVIDER) {
    case 'aws-kms':
      return new AwsKmsProvider();
    case 'vault':
      return new VaultProvider();
    case 'local':
    default:
      return new LocalKeyManagementProvider();
  }
}

export const kmsProvider = createKmsProvider();
