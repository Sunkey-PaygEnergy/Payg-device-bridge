import crypto from 'crypto';
import { pool } from '../db/index.js';
import { config } from '../config/index.js';
import { offlineKeypadAdapter } from '../adapters/offline-keypad.js';

export interface PaymentReceipt {
  receiptId: string;
  leaseId: bigint;
  deviceId: string;
  payerAddress?: string;
  customerPhone?: string;
  amount: bigint;
  fiatAmount?: number;
  fiatCurrency?: string;
  stellarTxHash: string;
  newPaidUntilDate: string;
  issuedAt: Date;
  signature: string;
}

export class PaymentReceiptService {
  /**
   * Generates a signed payment receipt with cryptographic authenticity tag
   */
  public async generateReceipt(
    leaseId: bigint,
    amount: bigint,
    stellarTxHash: string,
    fiatAmount?: number,
    fiatCurrency?: string
  ): Promise<PaymentReceipt> {
    const res = await pool.query<{
      device_id: string;
      customer_address: string;
      customer_phone: string;
      paid_until: string;
    }>(
      'SELECT device_id, customer_address, customer_phone, paid_until FROM leases WHERE lease_id = $1',
      [leaseId.toString()]
    );

    if (res.rows.length === 0) {
      throw new Error(`Lease not found for receipt: ${leaseId}`);
    }

    const row = res.rows[0];
    const receiptId = `RCP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const paidUntilDate = new Date(parseInt(row.paid_until || '0', 10) * 1000).toISOString();
    const issuedAt = new Date();

    const receiptPayload = `${receiptId}:${leaseId}:${amount}:${stellarTxHash}:${row.paid_until}`;
    const hmac = crypto.createHmac('sha256', config.DEVICE_HMAC_MASTER_KEY);
    hmac.update(receiptPayload);
    const signature = hmac.digest('hex');

    const receipt: PaymentReceipt = {
      receiptId,
      leaseId,
      deviceId: row.device_id,
      payerAddress: row.customer_address,
      customerPhone: row.customer_phone,
      amount,
      fiatAmount,
      fiatCurrency,
      stellarTxHash,
      newPaidUntilDate: paidUntilDate,
      issuedAt,
      signature,
    };

    // If customer has a phone, send SMS receipt confirmation
    if (row.customer_phone) {
      const smsText = `Sunkey Energy: Payment confirmed! Receipt #${receiptId}. Energy active until ${paidUntilDate.split('T')[0]}. Thank you!`;
      await offlineKeypadAdapter.lock({
        deviceId: row.device_id,
        operatorAddress: '',
        deviceModel: '',
        hardwareType: 'offline_keypad',
        openpaygoSecretKey: '',
        openpaygoTokenCount: 0,
        customerPhone: row.customer_phone,
        lastSyncStatus: 'unlocked',
      }); // Triggers SMS dispatch simulation
    }

    return receipt;
  }

  /**
   * Handles failed payment refund logging and operator notification
   */
  public async processRefund(
    transactionId: string,
    reason: string
  ): Promise<{ refundTicketId: string; status: string }> {
    const refundTicketId = `REF-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    await pool.query(
      `UPDATE transactions 
       SET status = 'refunded'
       WHERE id = $1`,
      [transactionId]
    );

    await pool.query(
      `INSERT INTO audit_logs (action, target_type, target_id, details)
       VALUES ('PAYMENT_REFUNDED', 'transaction', $1, $2)`,
      [transactionId, JSON.stringify({ refundTicketId, reason })]
    );

    console.log(`[Receipts] Refund ticket issued: ${refundTicketId} for transaction ${transactionId}. Reason: ${reason}`);

    return { refundTicketId, status: 'REFUND_RECORDED' };
  }
}

export const receiptService = new PaymentReceiptService();
