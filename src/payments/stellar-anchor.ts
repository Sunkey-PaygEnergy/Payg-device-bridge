import { PaymentGatewayProvider, IncomingPaymentEvent, PaymentSource } from './types.js';

export class StellarAnchorAdapter implements PaymentGatewayProvider {
  public readonly providerName: PaymentSource = 'stellar_anchor';

  /**
   * Parses webhook / transaction payload from a Stellar Anchor deposit service (SEP-24 / SEP-6)
   */
  public parseWebhook(raw: any, headers?: Record<string, string>): IncomingPaymentEvent {
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Anchor payload: { transaction_id, memo, amount_in, asset_code, status, from_account }
    const txId = payload.transaction_id || payload.id || `anchor_${Date.now()}`;
    const memo = String(payload.memo || payload.client_reference || '0');

    // Parse leaseId from memo, e.g. "lease:101" or numeric string
    let leaseId = 0n;
    if (memo.startsWith('lease:')) {
      leaseId = BigInt(memo.replace('lease:', '').trim());
    } else {
      leaseId = BigInt(memo.trim() || '0');
    }

    const fiatAmount = parseFloat(payload.amount_in || payload.amount || '0');
    const currency = payload.asset_code || 'USDC';

    // Stellar / Soroban uses 7 decimals (1 USDC = 10_000_000)
    const tokenAmount = BigInt(Math.round(fiatAmount * 10_000_000));

    return {
      idempotencyKey: `stellar_anchor_${txId}`,
      source: 'stellar_anchor',
      providerReference: txId,
      leaseId,
      payerAddress: payload.from_account || payload.account,
      customerPhone: payload.phone_number,
      fiatAmount,
      fiatCurrency: currency,
      tokenAmount,
      receivedAt: new Date(),
      rawPayload: payload,
    };
  }

  public verifySignature(payload: unknown, headers?: Record<string, string>): boolean {
    // In production anchor setup, verify signature header or anchor bearer token
    if (!headers) return true;
    const authHeader = headers['authorization'] || headers['x-anchor-signature'];
    return Boolean(authHeader);
  }
}

export const stellarAnchorAdapter = new StellarAnchorAdapter();
