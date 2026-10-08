export interface ContractEventRecord {
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topic: string[];
  value: any;
  pagingToken: string;
}

export interface IndexerCursor {
  id: string;
  lastPagingToken: string;
  lastLedgerSequence: number;
  lastEventTime?: Date;
}
