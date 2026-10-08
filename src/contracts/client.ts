import {
  rpc,
  Keypair,
  Address,
  Contract,
  Operation,
  xdr,
  scValToNative,
  nativeToScVal,
  TransactionBuilder,
  Account,
  BASE_FEE,
  Networks,
} from '@stellar/stellar-sdk';
import { config } from '../config/index.js';
import { Lease, AccessStatus, Plan } from './types.js';

export class SorobanContractClient {
  public server: rpc.Server;
  public contractId: string;
  public networkPassphrase: string;
  private bridgeKeypair?: Keypair;

  constructor() {
    this.server = new rpc.Server(config.STELLAR_RPC_URL, {
      allowHttp: config.NODE_ENV !== 'production',
    });
    this.contractId = config.CONTRACT_ID;
    this.networkPassphrase = config.STELLAR_NETWORK_PASSPHRASE;

    if (config.BRIDGE_OPERATOR_SECRET_KEY) {
      try {
        this.bridgeKeypair = Keypair.fromSecret(config.BRIDGE_OPERATOR_SECRET_KEY);
      } catch (e) {
        console.warn('Could not parse BRIDGE_OPERATOR_SECRET_KEY, signing disabled');
      }
    }
  }

  /**
   * Fetch AccessStatus for a lease: is_active, paid_until, is_owned, is_suspended, seconds_remaining
   */
  public async getAccess(leaseId: bigint): Promise<AccessStatus> {
    try {
      const contract = new Contract(this.contractId);
      const args = [nativeToScVal(leaseId, { type: 'u64' })];

      const simRes = await this.server.simulateTransaction(
        new TransactionBuilder(
          new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0'),
          { fee: BASE_FEE, networkPassphrase: this.networkPassphrase }
        )
          .addOperation(
            contract.call('get_access', ...args)
          )
          .setTimeout(30)
          .build()
      );

      if (rpc.Api.isSimulationSuccess(simRes) && simRes.result?.retval) {
        const native = scValToNative(simRes.result.retval);
        return {
          is_active: Boolean(native.is_active),
          paid_until: BigInt(native.paid_until ?? 0),
          is_owned: Boolean(native.is_owned),
          is_suspended: Boolean(native.is_suspended),
          seconds_remaining: BigInt(native.seconds_remaining ?? 0),
        };
      }
    } catch (err) {
      // In local development or offline testnet fallback
      console.warn(`[SorobanClient] getAccess simulated fallback for lease ${leaseId}:`, (err as Error).message);
    }

    // Default conservative state when RPC is unavailable
    return {
      is_active: false,
      paid_until: 0n,
      is_owned: false,
      is_suspended: false,
      seconds_remaining: 0n,
    };
  }

  /**
   * Fetch raw lease data from contract
   */
  public async getLease(leaseId: bigint): Promise<Lease | null> {
    try {
      const contract = new Contract(this.contractId);
      const args = [nativeToScVal(leaseId, { type: 'u64' })];

      const simRes = await this.server.simulateTransaction(
        new TransactionBuilder(
          new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0'),
          { fee: BASE_FEE, networkPassphrase: this.networkPassphrase }
        )
          .addOperation(
            contract.call('get_lease', ...args)
          )
          .setTimeout(30)
          .build()
      );

      if (rpc.Api.isSimulationSuccess(simRes) && simRes.result?.retval) {
        const native = scValToNative(simRes.result.retval);
        return {
          id: BigInt(native.id),
          operator: String(native.operator),
          customer: String(native.customer),
          plan_id: BigInt(native.plan_id),
          status: String(native.status) as any,
          total_paid: BigInt(native.total_paid),
          paid_until: BigInt(native.paid_until),
          deposit_paid: Boolean(native.deposit_paid),
          pool_id: native.pool_id ? BigInt(native.pool_id) : null,
          created_at: BigInt(native.created_at),
          last_payment_at: BigInt(native.last_payment_at),
        };
      }
    } catch (err) {
      console.warn(`[SorobanClient] getLease fallback for lease ${leaseId}:`, (err as Error).message);
    }
    return null;
  }

  /**
   * Submit pay() transaction to Soroban smart contract on behalf of customer / payer
   */
  public async submitPay(
    payerSecret: string,
    leaseId: bigint,
    amount: bigint
  ): Promise<{ txHash: string; success: boolean }> {
    const payerKeypair = Keypair.fromSecret(payerSecret);
    const contract = new Contract(this.contractId);
    const payerAddress = new Address(payerKeypair.publicKey());

    const account = await this.server.getAccount(payerKeypair.publicKey());
    const op = contract.call(
      'pay',
      payerAddress.toScVal(),
      nativeToScVal(leaseId, { type: 'u64' }),
      nativeToScVal(amount, { type: 'i128' })
    );

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(60)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(payerKeypair);

    const sendRes = await this.server.sendTransaction(prepared);
    if (sendRes.status === 'ERROR') {
      throw new Error(`Transaction submission error: ${JSON.stringify(sendRes)}`);
    }

    return {
      txHash: sendRes.hash,
      success: true,
    };
  }

  /**
   * Get contract events from Soroban RPC
   */
  public async getContractEvents(startLedger: number, limit = 100): Promise<rpc.Api.GetEventsResponse> {
    return await this.server.getEvents({
      startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [this.contractId],
        },
      ],
      limit,
    });
  }
}

export const sorobanClient = new SorobanContractClient();
