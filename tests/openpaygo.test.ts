import { describe, it, expect } from 'vitest';
import { OpenPAYGOTokenGenerator } from '../src/openpaygo/token.js';
import { OpenPAYGOTokenType } from '../src/openpaygo/types.js';

describe('OpenPAYGO Token Standard', () => {
  const secretKeyHex = '0123456789abcdef0123456789abcdef';

  it('should generate a 9-digit formatted numeric token', () => {
    const token = OpenPAYGOTokenGenerator.generateAddTimeToken(secretKeyHex, 1, 7);
    expect(token).toMatch(/^\d{3}-\d{3}-\d{3}$/);
  });

  it('should verify a valid token within the counter window', () => {
    const nextCount = 5;
    const token = OpenPAYGOTokenGenerator.generateAddTimeToken(secretKeyHex, nextCount, 30);

    const verification = OpenPAYGOTokenGenerator.verifyToken(
      token,
      secretKeyHex,
      4, // current device count is 4
      30,
      OpenPAYGOTokenType.ADD_TIME,
      10
    );

    expect(verification.isValid).toBe(true);
    expect(verification.matchedCount).toBe(5);
  });

  it('should reject a replay of an already-used counter token', () => {
    const oldToken = OpenPAYGOTokenGenerator.generateAddTimeToken(secretKeyHex, 2, 7);

    const verification = OpenPAYGOTokenGenerator.verifyToken(
      oldToken,
      secretKeyHex,
      5, // current device count is already 5
      7,
      OpenPAYGOTokenType.ADD_TIME,
      10
    );

    expect(verification.isValid).toBe(false);
  });

  it('should generate a permanent disable token', () => {
    const token = OpenPAYGOTokenGenerator.generateDisableToken(secretKeyHex, 10);
    expect(token).toMatch(/^\d{3}-\d{3}-\d{3}$/);

    const verification = OpenPAYGOTokenGenerator.verifyToken(
      token,
      secretKeyHex,
      9,
      0,
      OpenPAYGOTokenType.DISABLE_PAYG,
      5
    );

    expect(verification.isValid).toBe(true);
    expect(verification.matchedCount).toBe(10);
  });
});
