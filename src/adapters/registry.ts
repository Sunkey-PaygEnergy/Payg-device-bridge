import { DeviceAdapter, HardwareType } from './types.js';

export class AdapterRegistry {
  private adapters: Map<HardwareType, DeviceAdapter> = new Map();
  private modelOverrides: Map<string, DeviceAdapter> = new Map();

  public register(adapter: DeviceAdapter): void {
    this.adapters.set(adapter.hardwareType, adapter);
  }

  public registerModelOverride(model: string, adapter: DeviceAdapter): void {
    this.modelOverrides.set(model.toLowerCase(), adapter);
  }

  public getAdapter(hardwareType: HardwareType, model?: string): DeviceAdapter {
    if (model) {
      const override = this.modelOverrides.get(model.toLowerCase());
      if (override) return override;
    }

    const adapter = this.adapters.get(hardwareType);
    if (!adapter) {
      throw new Error(`No device adapter registered for hardware type: ${hardwareType}`);
    }
    return adapter;
  }
}

export const adapterRegistry = new AdapterRegistry();
