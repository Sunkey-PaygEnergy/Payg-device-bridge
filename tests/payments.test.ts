import { describe, it, expect } from 'vitest';
import { MpesaPaymentAdapter, MtnMomoPaymentAdapter, AirtelMoneyPaymentAdapter } from '../src/payments/mobile-money.js';
import { StellarAnchorAdapter } from '../src/payments/stellar-anchor.js';
import { CurrencyConverter } from '../src/payments/converter.js';

describe('Payment Adapters and Currency Conversion', () => {
  describe('CurrencyConverter', () => {
    const converter = new CurrencyConverter();

    it('accurately converts KES fiat payments to 7-decimal Soroban token units', () => {
      // 1305 KES @ 130.5 KES/USD = 10 USD = 100_000_000 units
      const converted = converter.convertFiatToToken(1305, 'KES', 7);
      expect(converted.usdValue).toBeCloseTo(10, 2);
      expect(converted.tokenUnits).toBe(100_000_000n);
    });

    it('accurately converts token units back to fiat currency', () => {
      const converted = converter.convertTokenToFiat(100_000_000n, 'KES', 7);
      expect(converted.usdValue).toBe(10);
      expect(converted.fiatAmount).toBe(1305);
    });
  });

  describe('Mobile Money Ingestion', () => {
    it('parses Safaricom M-Pesa C2B payment payload', () => {
      const adapter = new MpesaPaymentAdapter();
      const payload = {
        TransID: 'QG49ABC123',
        TransAmount: '2610.00',
        BillRefNumber: '101',
        MSISDN: '254712345678',
      };

      const event = adapter.parseWebhook(payload);

      expect(event.source).toBe('mpesa');
      expect(event.providerReference).toBe('QG49ABC123');
      expect(event.leaseId).toBe(101n);
      expect(event.fiatAmount).toBe(2610);
      expect(event.fiatCurrency).toBe('KES');
      expect(event.tokenAmount).toBeGreaterThan(0n);
    });

    it('parses MTN Mobile Money payment payload', () => {
      const adapter = new MtnMomoPaymentAdapter();
      const payload = {
        financialTransactionId: 'momo-998877',
        amount: '37200',
        currency: 'UGX',
        externalId: 'lease-205',
        payer: { partyId: '256770000000' },
      };

      const event = adapter.parseWebhook(payload);

      expect(event.source).toBe('mtn');
      expect(event.providerReference).toBe('momo-998877');
      expect(event.leaseId).toBe(205n);
      expect(event.fiatAmount).toBe(37200);
      expect(event.fiatCurrency).toBe('UGX');
    });

    it('parses Airtel Money payment payload', () => {
      const adapter = new AirtelMoneyPaymentAdapter();
      const payload = {
        transaction: {
          id: 'airtel-445566',
          amount: '74400',
          currency: 'UGX',
          message: '302',
        },
      };

      const event = adapter.parseWebhook(payload);

      expect(event.source).toBe('airtel');
      expect(event.providerReference).toBe('airtel-445566');
      expect(event.leaseId).toBe(302n);
    });

    it('parses Stellar Anchor deposit callback', () => {
      const adapter = new StellarAnchorAdapter();
      const payload = {
        transaction_id: 'stellar-tx-abc-123',
        memo: 'lease:55',
        amount_in: '25.50',
        asset_code: 'USDC',
        from_account: 'GBABC123',
      };

      const event = adapter.parseWebhook(payload);

      expect(event.source).toBe('stellar_anchor');
      expect(event.providerReference).toBe('stellar-tx-abc-123');
      expect(event.leaseId).toBe(55n);
      expect(event.fiatAmount).toBe(25.5);
      expect(event.tokenAmount).toBe(255_000_000n);
    });
  });
});
