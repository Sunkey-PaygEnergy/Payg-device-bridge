import { describe, it, expect } from 'vitest';
import { IoTConnectedAdapter } from '../src/adapters/iot-connected.js';
import { OfflineKeypadAdapter, MockSmsProvider } from '../src/adapters/offline-keypad.js';
import { DeviceInfo } from '../src/adapters/types.js';

describe('Hardware Device Adapters', () => {
  const dummyDevice: DeviceInfo = {
    deviceId: 'SINOWARE-SHB100-01',
    operatorAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    deviceModel: 'SunHome-Base 100',
    hardwareType: 'offline_keypad',
    openpaygoSecretKey: '0123456789abcdef0123456789abcdef',
    openpaygoTokenCount: 2,
    customerPhone: '+254712345678',
    lastSyncStatus: 'locked',
  };

  describe('OfflineKeypadAdapter', () => {
    it('generates activation token and dispatches SMS notification', async () => {
      const mockSms = new MockSmsProvider();
      const adapter = new OfflineKeypadAdapter(mockSms);

      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400); // 7 days ahead
      const result = await adapter.unlock(dummyDevice, validUntil);

      expect(result.success).toBe(true);
      expect(result.commandType).toBe('UNLOCK');
      expect(result.tokenGenerated).toBeDefined();
      expect(result.tokenGenerated).toMatch(/^\d{3}-\d{3}-\d{3}$/);
      expect(mockSms.sentMessages.length).toBe(1);
      expect(mockSms.sentMessages[0].message).toContain('Activation code');
    });

    it('generates permanent unlock token when device is fully paid off', async () => {
      const mockSms = new MockSmsProvider();
      const adapter = new OfflineKeypadAdapter(mockSms);

      const result = await adapter.unlockPermanent(dummyDevice);

      expect(result.success).toBe(true);
      expect(result.commandType).toBe('PERMANENT_UNLOCK');
      expect(result.tokenGenerated).toBeDefined();
      expect(mockSms.sentMessages[0].message).toContain('permanent unlock code');
    });
  });

  describe('IoTConnectedAdapter', () => {
    const iotAdapter = new IoTConnectedAdapter();

    it('parses incoming JSON telemetry payload into normalized TelemetryData', () => {
      const raw = {
        deviceId: 'VICTRON-SHS200-99',
        v_bat: 12800,
        v_pv: 19200,
        i_out: 1450,
        wh_total: 1540.5,
        relay_on: true,
        tampered: false,
      };

      const parsed = iotAdapter.parseTelemetry(raw);

      expect(parsed.deviceId).toBe('VICTRON-SHS200-99');
      expect(parsed.batteryVoltageMv).toBe(12800);
      expect(parsed.solarInputMv).toBe(19200);
      expect(parsed.outputCurrentMa).toBe(1450);
      expect(parsed.energyGeneratedWh).toBe(1540.5);
      expect(parsed.relayState).toBe(true);
      expect(parsed.tamperFlag).toBe(false);
    });

    it('creates lock command result structure', async () => {
      const result = await iotAdapter.lock({
        ...dummyDevice,
        hardwareType: 'iot_connected',
      });

      expect(result.success).toBe(true);
      expect(result.commandType).toBe('LOCK');
      expect(result.metadata).toHaveProperty('correlationId');
    });
  });
});
