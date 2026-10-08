import { PaymentGatewayProvider, IncomingPaymentEvent, PaymentSource } from './types.js';
import crypto from 'crypto';

export class MpesaPaymentAdapter implements PaymentGatewayProvider {
  public readonly providerName: PaymentSource = 'mpesa';

  public parseWebhook(raw: any): IncomingPaymentEvent {
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Support both C2B validation/confirmation and STK Push Callback formats
    let transId = '';
    let amount = 0;
    let billRef = '0';
    let phone = '';

    if (payload.Body?.stkCallback) {
      const cb = payload.Body.stkCallback;
      transId = cb.CheckoutRequestID || `stk_${Date.now()}`;
      const items: Array<{ Name: string; Value: any }> = cb.CallbackMetadata?.Item || [];
      for (const item of items) {
        if (item.Name === 'Amount') amount = Number(item.Value);
        if (item.Name === 'MpesaReceiptNumber') transId = String(item.Value);
        if (item.Name === 'PhoneNumber') phone = String(item.Value);
      }
      billRef = payload.billRefNumber || '0';
    } else {
      transId = payload.TransID || payload.TransactionId || `c2b_${Date.now()}`;
      amount = parseFloat(payload.TransAmount || payload.amount || '0');
      billRef = String(payload.BillRefNumber || payload.AccountReference || '0');
      phone = String(payload.MSISDN || payload.phone || '');
    }

    const leaseId = BigInt(billRef.replace(/[^0-9]/g, '') || '0');
    // Approximate conversion rate: 1 USD ~ 130 KES, converted to 7 decimal Soroban token
    const tokenAmount = BigInt(Math.round((amount / 130.0) * 10_000_000));

    return {
      idempotencyKey: `mpesa_${transId}`,
      source: 'mpesa',
      providerReference: transId,
      leaseId,
      customerPhone: phone,
      fiatAmount: amount,
      fiatCurrency: 'KES',
      tokenAmount,
      receivedAt: new Date(),
      rawPayload: payload,
    };
  }

  public verifySignature(payload: unknown, headers?: Record<string, string>): boolean {
    // In production, verify Safaricom SSL/IP range or webhook passkey
    return true;
  }
}

export class MtnMomoPaymentAdapter implements PaymentGatewayProvider {
  public readonly providerName: PaymentSource = 'mtn';

  public parseWebhook(raw: any): IncomingPaymentEvent {
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const ref = payload.financialTransactionId || payload.externalId || `mtn_${Date.now()}`;
    const amount = parseFloat(payload.amount || '0');
    const currency = payload.currency || 'UGX';
    const phone = payload.payer?.partyId || payload.payerPhone || '';
    const leaseId = BigInt(String(payload.externalId || '0').replace(/[^0-9]/g, '') || '0');

    // Approximate conversion: 1 USD ~ 3700 UGX
    const tokenAmount = BigInt(Math.round((amount / 3700.0) * 10_000_000));

    return {
      idempotencyKey: `mtn_${ref}`,
      source: 'mtn',
      providerReference: ref,
      leaseId,
      customerPhone: phone,
      fiatAmount: amount,
      fiatCurrency: currency,
      tokenAmount,
      receivedAt: new Date(),
      rawPayload: payload,
    };
  }

  public verifySignature(payload: unknown, headers?: Record<string, string>): boolean {
    return true;
  }
}

export class AirtelMoneyPaymentAdapter implements PaymentGatewayProvider {
  public readonly providerName: PaymentSource = 'airtel';

  public parseWebhook(raw: any): IncomingPaymentEvent {
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const tx = payload.transaction || payload;
    const ref = tx.id || tx.airtel_money_id || `airtel_${Date.now()}`;
    const amount = parseFloat(tx.amount || '0');
    const currency = tx.currency || 'UGX';
    const phone = tx.phone || payload.subscriber?.msisdn || '';
    const leaseId = BigInt(String(tx.message || tx.reference || '0').replace(/[^0-9]/g, '') || '0');

    const tokenAmount = BigInt(Math.round((amount / 3700.0) * 10_000_000));

    return {
      idempotencyKey: `airtel_${ref}`,
      source: 'airtel',
      providerReference: ref,
      leaseId,
      customerPhone: phone,
      fiatAmount: amount,
      fiatCurrency: currency,
      tokenAmount,
      receivedAt: new Date(),
      rawPayload: payload,
    };
  }

  public verifySignature(payload: unknown, headers?: Record<string, string>): boolean {
    return true;
  }
}

export const mpesaAdapter = new MpesaPaymentAdapter();
export const mtnAdapter = new MtnMomoPaymentAdapter();
export const airtelAdapter = new AirtelMoneyPaymentAdapter();
