export type HardwareType = 'iot_connected' | 'offline_keypad';

export interface DeviceInfo {
  deviceId: string;
  operatorAddress: string;
  deviceModel: string;
  hardwareType: HardwareType;
  openpaygoSecretKey: string;
  openpaygoTokenCount: number;
  customerPhone?: string | null;
  lastSyncStatus: 'locked' | 'unlocked' | 'owned';
}

export interface CommandResult {
  success: boolean;
  commandType: 'LOCK' | 'UNLOCK' | 'PERMANENT_UNLOCK' | 'SYNC_STATE';
  tokenGenerated?: string;
  dispatchedAt: Date;
  latencyMs: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface TelemetryData {
  deviceId: string;
  batteryVoltageMv?: number;
  solarInputMv?: number;
  outputCurrentMa?: number;
  energyGeneratedWh?: number;
  relayState: boolean;
  tamperFlag: boolean;
  recordedAt: Date;
  rawPayload?: Record<string, unknown>;
}

export interface DeviceAdapter {
  readonly hardwareType: HardwareType;
  readonly name: string;

  /**
   * Instructs the hardware to cut load relay / lock access
   */
  lock(device: DeviceInfo): Promise<CommandResult>;

  /**
   * Instructs the hardware to enable load relay until timestamp or by adding seconds
   */
  unlock(device: DeviceInfo, validUntilSeconds: bigint): Promise<CommandResult>;

  /**
   * Instructs the hardware to permanently deactivate PAYG lockout (device ownership transfer)
   */
  unlockPermanent(device: DeviceInfo): Promise<CommandResult>;

  /**
   * Normalizes incoming raw telemetry packet into standard TelemetryData
   */
  parseTelemetry(payload: unknown): TelemetryData;

  /**
   * Checks if device is currently reachable / active
   */
  ping(device: DeviceInfo): Promise<boolean>;
}
