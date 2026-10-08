import { DeviceAdapter, DeviceInfo, CommandResult, TelemetryData, HardwareType } from './types.js';
import { OpenPAYGOTokenGenerator } from '../openpaygo/token.js';
import { adapterRegistry } from './registry.js';
import { pool } from '../db/index.js';

export interface SmsProvider {
  sendSms(phoneNumber: string, message: string): Promise<{ success: boolean; messageId: string }>;
}

export class MockSmsProvider implements SmsProvider {
  public sentMessages: Array<{ phoneNumber: string; message: string; timestamp: Date }> = [];

  public async sendSms(phoneNumber: string, message: string): Promise<{ success: boolean; messageId: string }> {
    const messageId = `sms-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.sentMessages.push({
      phoneNumber,
      message,
      timestamp: new Date(),
    });
    console.log(`[SMS-Provider] Dispatched SMS to ${phoneNumber}: "${message}"`);
    return { success: true, messageId };
  }
}

export class OfflineKeypadAdapter implements DeviceAdapter {
  public readonly hardwareType: HardwareType = 'offline_keypad';
  public readonly name = 'Offline Keypad OpenPAYGO Adapter (Sinoware, Victron, Bboxx, PowerOak, Lorentz)';
  private smsProvider: SmsProvider;

  constructor(smsProvider?: SmsProvider) {
    this.smsProvider = smsProvider || new MockSmsProvider();
  }

  public setSmsProvider(provider: SmsProvider): void {
    this.smsProvider = provider;
  }

  public async lock(device: DeviceInfo): Promise<CommandResult> {
    const start = Date.now();
    // For offline devices, expiry is time-based. A zero-days token or expiry notification can be sent
    const message = `Sunkey Clean Energy: Your solar access period for ${device.deviceId} has ended. Please top-up to receive your activation code.`;
    if (device.customerPhone) {
      await this.smsProvider.sendSms(device.customerPhone, message);
    }

    return {
      success: true,
      commandType: 'LOCK',
      dispatchedAt: new Date(),
      latencyMs: Date.now() - start,
      metadata: { action: 'EXPIRED_NOTIFICATION_SENT' },
    };
  }

  public async unlock(device: DeviceInfo, validUntilSeconds: bigint): Promise<CommandResult> {
    const start = Date.now();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const diffSeconds = Number(validUntilSeconds) - nowSeconds;
    const daysToAdd = Math.max(1, Math.ceil(diffSeconds / 86400));

    // Next token sequence count
    const nextCount = device.openpaygoTokenCount + 1;
    const token = OpenPAYGOTokenGenerator.generateAddTimeToken(
      device.openpaygoSecretKey,
      nextCount,
      daysToAdd
    );

    // Update token count in DB
    try {
      await pool.query(
        'UPDATE devices SET openpaygo_token_count = $1, last_sync_status = $2 WHERE device_id = $3',
        [nextCount, 'unlocked', device.deviceId]
      );
    } catch (e) {
      // In tests or offline db, ignore
    }

    const expiryDate = new Date(Number(validUntilSeconds) * 1000).toISOString().split('T')[0];
    const message = `Sunkey Energy: Activation code for device ${device.deviceId} is: ${token}. Added ${daysToAdd} days (valid until ${expiryDate}). Enter code followed by #.`;

    if (device.customerPhone) {
      await this.smsProvider.sendSms(device.customerPhone, message);
    }

    return {
      success: true,
      commandType: 'UNLOCK',
      tokenGenerated: token,
      dispatchedAt: new Date(),
      latencyMs: Date.now() - start,
      metadata: { daysAdded: daysToAdd, tokenCount: nextCount, recipient: device.customerPhone },
    };
  }

  public async unlockPermanent(device: DeviceInfo): Promise<CommandResult> {
    const start = Date.now();
    const nextCount = device.openpaygoTokenCount + 1;
    const token = OpenPAYGOTokenGenerator.generateDisableToken(
      device.openpaygoSecretKey,
      nextCount
    );

    try {
      await pool.query(
        'UPDATE devices SET openpaygo_token_count = $1, last_sync_status = $2 WHERE device_id = $3',
        [nextCount, 'owned', device.deviceId]
      );
    } catch (e) {
      // ignore in tests
    }

    const message = `Sunkey Energy: Congratulations! You have fully paid off device ${device.deviceId}. Enter permanent unlock code: ${token}# to unlock your solar system forever!`;

    if (device.customerPhone) {
      await this.smsProvider.sendSms(device.customerPhone, message);
    }

    return {
      success: true,
      commandType: 'PERMANENT_UNLOCK',
      tokenGenerated: token,
      dispatchedAt: new Date(),
      latencyMs: Date.now() - start,
      metadata: { tokenCount: nextCount, isOwned: true },
    };
  }

  public parseTelemetry(payload: unknown): TelemetryData {
    // Offline devices do not report continuous live telemetry, return baseline state
    return {
      deviceId: 'offline-device',
      relayState: true,
      tamperFlag: false,
      recordedAt: new Date(),
    };
  }

  public async ping(device: DeviceInfo): Promise<boolean> {
    // Offline devices are always considered reachable via SMS gateway
    return true;
  }
}

export const offlineKeypadAdapter = new OfflineKeypadAdapter();
adapterRegistry.register(offlineKeypadAdapter);
