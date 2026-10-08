import mqtt, { MqttClient } from 'mqtt';
import { DeviceAdapter, DeviceInfo, CommandResult, TelemetryData, HardwareType } from './types.js';
import { config } from '../config/index.js';
import { adapterRegistry } from './registry.js';
import crypto from 'crypto';

export class IoTConnectedAdapter implements DeviceAdapter {
  public readonly hardwareType: HardwareType = 'iot_connected';
  public readonly name = 'IoT Connected MQTT/HTTP Adapter';
  private mqttClient?: MqttClient;
  private pendingResponses: Map<string, (result: any) => void> = new Map();

  constructor() {
    this.initMqtt();
  }

  private initMqtt(): void {
    try {
      this.mqttClient = mqtt.connect(config.MQTT_BROKER_URL, {
        username: config.MQTT_USERNAME,
        password: config.MQTT_PASSWORD,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
      });

      this.mqttClient.on('connect', () => {
        if (config.NODE_ENV !== 'test') {
          console.log('[IoTAdapter] Connected to MQTT broker:', config.MQTT_BROKER_URL);
        }
        // Subscribe to device telemetry & command acks
        this.mqttClient?.subscribe(`${config.MQTT_TOPIC_PREFIX}/+/telemetry`);
        this.mqttClient?.subscribe(`${config.MQTT_TOPIC_PREFIX}/+/ack`);
      });

      this.mqttClient.on('message', (topic, payload) => {
        this.handleIncomingMessage(topic, payload);
      });

      this.mqttClient.on('error', (err) => {
        if (config.NODE_ENV !== 'test') {
          console.warn('[IoTAdapter] MQTT error:', err.message);
        }
      });
    } catch (err) {
      if (config.NODE_ENV !== 'test') {
        console.warn('[IoTAdapter] Failed to initialize MQTT client:', (err as Error).message);
      }
    }
  }

  private handleIncomingMessage(topic: string, payload: Buffer): void {
    try {
      const parts = topic.split('/');
      const deviceId = parts[2];
      const type = parts[3];

      if (type === 'ack') {
        const data = JSON.parse(payload.toString());
        const correlationId = data.correlationId;
        if (correlationId && this.pendingResponses.has(correlationId)) {
          this.pendingResponses.get(correlationId)!(data);
          this.pendingResponses.delete(correlationId);
        }
      }
    } catch (e) {
      console.error('[IoTAdapter] Error parsing message:', e);
    }
  }

  private signPayload(payload: object, secretKey: string): string {
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }

  public async lock(device: DeviceInfo): Promise<CommandResult> {
    const start = Date.now();
    const correlationId = crypto.randomUUID();
    const topic = `${config.MQTT_TOPIC_PREFIX}/${device.deviceId}/cmd`;

    const cmdPayload = {
      correlationId,
      action: 'LOCK',
      deviceId: device.deviceId,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signature = this.signPayload(cmdPayload, device.openpaygoSecretKey);
    const fullMessage = JSON.stringify({ ...cmdPayload, signature });

    if (this.mqttClient && this.mqttClient.connected) {
      this.mqttClient.publish(topic, fullMessage, { qos: 1 });
    }

    return {
      success: true,
      commandType: 'LOCK',
      dispatchedAt: new Date(),
      latencyMs: Date.now() - start,
      metadata: { correlationId, topic },
    };
  }

  public async unlock(device: DeviceInfo, validUntilSeconds: bigint): Promise<CommandResult> {
    const start = Date.now();
    const correlationId = crypto.randomUUID();
    const topic = `${config.MQTT_TOPIC_PREFIX}/${device.deviceId}/cmd`;

    const cmdPayload = {
      correlationId,
      action: 'UNLOCK',
      deviceId: device.deviceId,
      validUntil: Number(validUntilSeconds),
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signature = this.signPayload(cmdPayload, device.openpaygoSecretKey);
    const fullMessage = JSON.stringify({ ...cmdPayload, signature });

    if (this.mqttClient && this.mqttClient.connected) {
      this.mqttClient.publish(topic, fullMessage, { qos: 1 });
    }

    return {
      success: true,
      commandType: 'UNLOCK',
      dispatchedAt: new Date(),
      latencyMs: Date.now() - start,
      metadata: { correlationId, validUntil: Number(validUntilSeconds) },
    };
  }

  public async unlockPermanent(device: DeviceInfo): Promise<CommandResult> {
    const start = Date.now();
    const correlationId = crypto.randomUUID();
    const topic = `${config.MQTT_TOPIC_PREFIX}/${device.deviceId}/cmd`;

    const cmdPayload = {
      correlationId,
      action: 'PERMANENT_UNLOCK',
      deviceId: device.deviceId,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const signature = this.signPayload(cmdPayload, device.openpaygoSecretKey);
    const fullMessage = JSON.stringify({ ...cmdPayload, signature });

    if (this.mqttClient && this.mqttClient.connected) {
      this.mqttClient.publish(topic, fullMessage, { qos: 1 });
    }

    return {
      success: true,
      commandType: 'PERMANENT_UNLOCK',
      dispatchedAt: new Date(),
      latencyMs: Date.now() - start,
      metadata: { correlationId },
    };
  }

  public parseTelemetry(raw: any): TelemetryData {
    const payload = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    return {
      deviceId: payload.deviceId || payload.device_id || 'unknown',
      batteryVoltageMv: payload.batteryVoltageMv ?? payload.v_bat ?? 12600,
      solarInputMv: payload.solarInputMv ?? payload.v_pv ?? 18500,
      outputCurrentMa: payload.outputCurrentMa ?? payload.i_out ?? 1200,
      energyGeneratedWh: payload.energyGeneratedWh ?? payload.wh_total ?? 0,
      relayState: Boolean(payload.relayState ?? payload.relay_on ?? false),
      tamperFlag: Boolean(payload.tamperFlag ?? payload.tampered ?? false),
      recordedAt: payload.timestamp ? new Date(payload.timestamp * 1000) : new Date(),
      rawPayload: payload,
    };
  }

  public async ping(device: DeviceInfo): Promise<boolean> {
    return Boolean(this.mqttClient && this.mqttClient.connected);
  }

  public close(): void {
    if (this.mqttClient) {
      this.mqttClient.end();
    }
  }
}

export const ioTConnectedAdapter = new IoTConnectedAdapter();
adapterRegistry.register(ioTConnectedAdapter);
