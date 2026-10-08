import { describe, it, expect } from 'vitest';
import { DeviceHmacSecurity } from '../src/security/hmac.js';
import { LocalKeyManagementProvider } from '../src/security/kms.js';

describe('Security & Cryptography Modules', () => {
  const secretKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  describe('DeviceHmacSecurity', () => {
    it('produces identical HMAC signatures regardless of key ordering', () => {
      const payload1 = { deviceId: 'DEV-001', action: 'LOCK', timestamp: 1700000000 };
      const payload2 = { timestamp: 1700000000, action: 'LOCK', deviceId: 'DEV-001' };

      const sig1 = DeviceHmacSecurity.sign(payload1, secretKeyHex);
      const sig2 = DeviceHmacSecurity.sign(payload2, secretKeyHex);

      expect(sig1).toBe(sig2);
    });

    it('successfully verifies genuine signature and rejects tampered payload', () => {
      const payload = { deviceId: 'DEV-001', relay_state: true, timestamp: Math.floor(Date.now() / 1000) };
      const sig = DeviceHmacSecurity.sign(payload, secretKeyHex);

      expect(DeviceHmacSecurity.verify(payload, sig, secretKeyHex)).toBe(true);
      expect(DeviceHmacSecurity.verify({ ...payload, relay_state: false }, sig, secretKeyHex)).toBe(false);
    });

    it('rejects telemetry packets with excessive clock skew', () => {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 1000; // 1000s in past
      const payload = { deviceId: 'DEV-001', timestamp: staleTimestamp };
      const sig = DeviceHmacSecurity.sign(payload, secretKeyHex);

      const res = DeviceHmacSecurity.validateTelemetryPacket(payload, sig, secretKeyHex, 300);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('skew exceeded');
    });
  });

  describe('LocalKeyManagementProvider', () => {
    const kms = new LocalKeyManagementProvider('test-master-key-with-sufficient-length-32-bytes');

    it('deterministically derives device keys', async () => {
      const key1 = await kms.deriveDeviceKey('DEV-101', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
      const key2 = await kms.deriveDeviceKey('DEV-101', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
      const otherKey = await kms.deriveDeviceKey('DEV-102', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');

      expect(key1).toBe(key2);
      expect(key1).not.toBe(otherKey);
      expect(key1.length).toBe(32); // 16 bytes hex
    });

    it('encrypts and decrypts secrets with AES-256-GCM authenticated encryption', async () => {
      const plaintext = 'super-secret-operator-private-key';
      const ciphertext = await kms.encryptSecret(plaintext);

      expect(ciphertext).not.toBe(plaintext);
      expect(ciphertext).toContain(':');

      const decrypted = await kms.decryptSecret(ciphertext);
      expect(decrypted).toBe(plaintext);
    });
  });
});
