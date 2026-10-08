export type PaymentSource =
  | 'mpesa'
  | 'mtn'
  | 'airtel'
  | 'stellar_anchor'
  | 'direct_crypto';

export interface IncomingPaymentEvent {
  idempotencyKey: string;
  source: PaymentSource;
  providerReference: string;
  leaseId: bigint;
  customerPhone?: string;
  payerAddress?: string;
  fiatAmount: number;
  fiatCurrency: string;
  tokenAmount: bigint; // Scaled to 7 decimals for Stellar/Soroban token
  receivedAt: Date;
  rawPayload: Record<string, unknown>;
}

export interface PaymentProcessingResult {
  success: boolean;
  idempotencyKey: string;
  leaseId: bigint;
  stellarTxHash?: string;
  secondsAdded?: bigint;
  status: 'CONFIRMED' | 'DUPLICATE' | 'FAILED' | 'REFUNDED';
  errorMessage?: string;
  processedAt: Date;
}

export interface PaymentGatewayProvider {
  readonly providerName: PaymentSource;

  /**
   * Parses and validates raw incoming webhook payload from provider
   */
  parseWebhook(payload: unknown, headers?: Record<string, string>): IncomingPaymentEvent;

  /**
   * Cryptographically verifies webhook authenticity (HMAC signature or IP whitelist)
   */
  verifySignature(payload: unknown, headers?: Record<string, string>): boolean;
}
