export interface DeviceSyncJobData {
  deviceId: string;
  leaseId: string;
  trigger: 'cron' | 'payment' | 'contract_event' | 'manual';
}

export interface SyncResult {
  deviceId: string;
  leaseId: string;
  previousStatus: string;
  newStatus: 'locked' | 'unlocked' | 'owned';
  tokenGenerated?: string;
  dispatched: boolean;
  timestamp: Date;
}
