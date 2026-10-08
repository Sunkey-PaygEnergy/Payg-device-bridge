import crypto from 'crypto';
import { OpenPAYGOTokenType, GenerateTokenOptions, DecodedToken } from './types.js';

export class OpenPAYGOTokenGenerator {
  /**
   * Generates a 9-digit OpenPAYGO token formatted as XXX-XXX-XXX
   */
  public static generateToken(opts: GenerateTokenOptions): string {
    const { secretKeyHex, count, value, tokenType } = opts;

    // Buffer: [tokenType (1 byte), count (4 bytes BE), value (4 bytes BE)]
    const payload = Buffer.alloc(9);
    payload.writeUInt8(tokenType, 0);
    payload.writeUInt32BE(count, 1);
    payload.writeUInt32BE(value, 5);

    // Compute HMAC-SHA256 using device secret key
    const secretKey = Buffer.from(secretKeyHex, 'hex');
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(payload);
    const hash = hmac.digest();

    // Dynamic truncation to extract 32-bit integer
    const offset = hash[hash.length - 1] & 0x0f;
    const binary =
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff);

    // 9-digit numeric token (modulo 10^9)
    const tokenNum = binary % 1000000000;
    const tokenStr = tokenNum.toString().padStart(9, '0');

    // Format as XXX-XXX-XXX for easy keypad entry
    return `${tokenStr.slice(0, 3)}-${tokenStr.slice(3, 6)}-${tokenStr.slice(6, 9)}`;
  }

  /**
   * Generates an unlock token for adding days of access
   */
  public static generateAddTimeToken(secretKeyHex: string, count: number, days: number): string {
    return this.generateToken({
      secretKeyHex,
      count,
      value: days,
      tokenType: OpenPAYGOTokenType.ADD_TIME,
    });
  }

  /**
   * Generates a permanent unlock / disable token (device ownership)
   */
  public static generateDisableToken(secretKeyHex: string, count: number): string {
    return this.generateToken({
      secretKeyHex,
      count,
      value: 0,
      tokenType: OpenPAYGOTokenType.DISABLE_PAYG,
    });
  }

  /**
   * Verifies if an input token matches the expected generated token for a given counter window
   */
  public static verifyToken(
    inputToken: string,
    secretKeyHex: string,
    currentCount: number,
    value: number,
    tokenType: OpenPAYGOTokenType,
    window = 10
  ): { isValid: boolean; matchedCount?: number } {
    const cleanInput = inputToken.replace(/[^0-9]/g, '');

    for (let c = currentCount + 1; c <= currentCount + window; c++) {
      const candidate = this.generateToken({
        secretKeyHex,
        count: c,
        value,
        tokenType,
      }).replace(/[^0-9]/g, '');

      if (candidate === cleanInput) {
        return { isValid: true, matchedCount: c };
      }
    }

    return { isValid: false };
  }
}
