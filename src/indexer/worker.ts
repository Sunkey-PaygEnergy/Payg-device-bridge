import { scValToNative } from '@stellar/stellar-sdk';
import { pool } from '../db/index.js';
import { sorobanClient } from '../contracts/client.js';
import { ContractEventRecord } from './types.js';

export type EventHandler = (event: ContractEventRecord) => Promise<void>;

export class SorobanEventIndexer {
  private isRunning = false;
  private pollIntervalMs: number;
  private cursorId = 'soroban_events_cursor';
  private handlers: Map<string, EventHandler[]> = new Map();

  constructor(pollIntervalMs = 5000) {
    this.pollIntervalMs = pollIntervalMs;
  }

  public registerHandler(eventName: string, handler: EventHandler): void {
    const list = this.handlers.get(eventName) || [];
    list.push(handler);
    this.handlers.set(eventName, list);
  }

  public async getCursor(): Promise<{ lastLedger: number; lastToken: string }> {
    const res = await pool.query<{ last_ledger_sequence: string; last_paging_token: string }>(
      'SELECT last_ledger_sequence, last_paging_token FROM indexer_cursors WHERE id = $1',
      [this.cursorId]
    );

    if (res.rows.length === 0) {
      // Default initial cursor
      return { lastLedger: 1, lastToken: '0' };
    }

    return {
      lastLedger: parseInt(res.rows[0].last_ledger_sequence, 10),
      lastToken: res.rows[0].last_paging_token,
    };
  }

  public async saveCursor(ledger: number, pagingToken: string): Promise<void> {
    await pool.query(
      `INSERT INTO indexer_cursors (id, last_ledger_sequence, last_paging_token, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET 
         last_ledger_sequence = EXCLUDED.last_ledger_sequence,
         last_paging_token = EXCLUDED.last_paging_token,
         updated_at = CURRENT_TIMESTAMP`,
      [this.cursorId, ledger, pagingToken]
    );
  }

  public async pollEvents(): Promise<number> {
    try {
      const { lastLedger } = await this.getCursor();
      const response = await sorobanClient.getContractEvents(lastLedger, 50);

      if (!response.events || response.events.length === 0) {
        return 0;
      }

      let processedCount = 0;
      let highestLedger = lastLedger;
      let lastPagingToken = '0';

      for (const ev of response.events) {
        try {
          const rawTopics = ev.topic || [];
          const decodedTopics = rawTopics.map((t) => {
            try {
              return String(scValToNative(t));
            } catch {
              return 'unknown';
            }
          });

          const decodedValue = ev.value ? scValToNative(ev.value) : null;
          const eventName = decodedTopics[0] || 'unknown';

          const record: ContractEventRecord = {
            id: ev.id,
            type: ev.type,
            ledger: ev.ledger,
            ledgerClosedAt: ev.ledgerClosedAt,
            contractId: ev.contractId ? ev.contractId.toString() : '',
            topic: decodedTopics,
            value: decodedValue,
            pagingToken: ev.pagingToken,
          };

          // Dispatch to registered event handlers
          const eventHandlers = this.handlers.get(eventName) || [];
          for (const handler of eventHandlers) {
            await handler(record);
          }

          if (ev.ledger > highestLedger) {
            highestLedger = ev.ledger;
          }
          lastPagingToken = ev.pagingToken;
          processedCount++;
        } catch (eventErr) {
          console.error(`[EventIndexer] Error processing individual event ${ev.id}:`, eventErr);
        }
      }

      if (processedCount > 0) {
        await this.saveCursor(highestLedger, lastPagingToken);
      }

      return processedCount;
    } catch (err) {
      console.warn('[EventIndexer] Poll error (waiting for next interval):', (err as Error).message);
      return 0;
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const loop = async () => {
      if (!this.isRunning) return;
      await this.pollEvents();
      if (this.isRunning) {
        setTimeout(loop, this.pollIntervalMs);
      }
    };

    loop();
  }

  public stop(): void {
    this.isRunning = false;
  }
}

export const eventIndexer = new SorobanEventIndexer();
