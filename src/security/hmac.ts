import crypto from 'crypto';

export interface DeviceCommandPayload {
  action: string;
  deviceId: string;
  timestamp: number;
  nonce?: string;
  [key: string]: unknown;
}

export interface SignedPayload<T = DeviceCommandPayload> {
  payload: T;
  signature: string;
}

export class DeviceHmacSecurity {
  /**
   * Serializes payload canonically to prevent key-order mismatch during verification
   */
  public static canonicalStringify(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return '[' + obj.map((x) => this.canonicalStringify(x)).join(',') + ']';
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${this.canonicalStringify((obj as Record<string, unknown>)[k])}`
    );
    return '{' + parts.join(',') + '}';
  }

  /**
   * Computes HMAC-SHA256 signature over canonically serialized payload
   */
  public static sign(payload: unknown, secretKeyHex: string): string {
    const canonical = this.canonicalStringify(payload);
    const key = Buffer.from(secretKeyHex, 'hex');
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(canonical);
    return hmac.digest('hex');
  }

  /**
   * Verifies signature using constant-time comparison to prevent timing attacks
   */
  public static verify(payload: unknown, signature: string, secretKeyHex: string): boolean {
    try {
      const expectedSignature = this.sign(payload, secretKeyHex);
      const sigBuf = Buffer.from(signature, 'hex');
      const expectedBuf = Buffer.from(expectedSignature, 'hex');

      if (sigBuf.length !== expectedBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  /**
   * Creates a signed device command packet with cryptographic nonce and timestamp
   */
  public static createSignedCommand<T extends DeviceCommandPayload>(
    command: T,
    secretKeyHex: string
  ): SignedPayload<T> {
    const payloadWithNonce: T = {
      ...command,
      timestamp: command.timestamp || Math.floor(Date.now() / 1000),
      nonce: command.nonce || crypto.randomBytes(8).toString('hex'),
    };

    const signature = this.sign(payloadWithNonce, secretKeyHex);
    return {
      payload: payloadWithNonce,
      signature,
    };
  }

  /**
   * Validates incoming device telemetry packet against HMAC and replay window
   */
  public static validateTelemetryPacket(
    payload: Record<string, unknown>,
    signature: string,
    secretKeyHex: string,
    maxSkewSeconds = 300
  ): { valid: boolean; reason?: string } {
    const timestamp = Number(payload.timestamp);
    if (!timestamp || isNaN(timestamp)) {
      return { valid: false, reason: 'Missing or invalid timestamp in payload' };
    }

    const now = Math.floor(Date.now() / 1000);
    const skew = Math.abs(now - timestamp);
    if (skew > maxSkewSeconds) {
      return { valid: false, reason: `Timestamp skew exceeded (${skew}s > ${maxSkewSeconds}s allowed)` };
    }

    const isValid = this.verify(payload, signature, secretKeyHex);
    if (!isValid) {
      return { valid: false, reason: 'Invalid HMAC signature' };
    }

    return { valid: true };
  }
}
