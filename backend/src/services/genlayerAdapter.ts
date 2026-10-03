import { createAccount, createClient } from 'genlayer-js';
import { testnetAsimov, testnetBradbury, studionet, localnet } from 'genlayer-js/chains';
import { ExecutionResult, TransactionHashVariant, TransactionStatus, transactionsStatusNumberToName, type GenLayerTransaction } from 'genlayer-js/types';
import { onchainRecordSchema } from '../schemas/domain.js';
import type { OnchainRecord } from '../types/domain.js';
import type { AppConfig } from '../config/env.js';

type SdkTransactionHash = `0x${string}` & { length: 66 };

export type GenLayerPollResult = {
  state: 'PENDING' | 'FINALIZED' | 'FAILED';
  transactionStatus: string;
  consensusState: string | null;
  record?: OnchainRecord;
  errorCode?: string;
  errorMessage?: string;
  blockReference?: Record<string, unknown>;
};

export interface GenLayerAdapter {
  readonly configured: boolean;
  readonly network: string | null;
  readonly contractAddress: `0x${string}` | null;
  submit(packageJson: string, packageHash: string): Promise<string>;
  poll(transactionHash: string, expected: { reviewId: string; recordId: string; packageHash: string }): Promise<GenLayerPollResult>;
  health(): Promise<{ status: string; connected: boolean; network: string | null; contractAddress: string | null; detail: string | null }>;
}

export class DisabledGenLayerAdapter implements GenLayerAdapter {
  readonly configured = false;
  readonly network = null;
  readonly contractAddress = null;

  async submit(): Promise<string> { throw new Error('GenLayer is disabled; no transaction was submitted.'); }
  async poll(): Promise<GenLayerPollResult> { throw new Error('GenLayer is disabled; no transaction state was queried.'); }
  async health() { return { status: 'DISABLED', connected: false, network: null, contractAddress: null, detail: 'GenLayer integration is disabled; no live RPC operation has been attempted.' }; }
}

export class GenLayerStatusError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly chainState?: { transactionStatus: string; consensusState: string | null; blockReference?: Record<string, unknown> },
  ) { super(message); this.name = 'GenLayerStatusError'; }
}

function chainFor(config: AppConfig) {
  switch (config.genlayerNetwork) {
    case 'testnetAsimov': return testnetAsimov;
    case 'testnetBradbury': return testnetBradbury;
    case 'studionet': return studionet;
    case 'localnet': return localnet;
  }
}

function asStatusName(transaction: GenLayerTransaction): string {
  if (typeof transaction.statusName === 'string') return transaction.statusName;
  if (typeof transaction.status === 'number') return transactionsStatusNumberToName[String(transaction.status) as keyof typeof transactionsStatusNumberToName] ?? `UNKNOWN_${transaction.status}`;
  return typeof transaction.status === 'string' ? transaction.status : 'UNKNOWN';
}

function safeString(value: unknown, max = 1000): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().replace(/\u0000/g, '').slice(0, max);
}

function safeObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') output[key] = item.slice(0, 500);
    else if (typeof item === 'number' || typeof item === 'boolean' || item === null) output[key] = item;
  }
  return output;
}

function redactConfiguredSecrets(message: string, config: AppConfig) {
  let sanitized = message;
  for (const secret of [config.genlayerRpc, config.genlayerPrivateKey, config.databaseUrl, config.s3AccessKeyId, config.s3SecretAccessKey, config.oidcJwksUrl]) {
    if (secret) sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  return sanitized
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:api[_-]?key|token|secret|signature)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .slice(0, 500);
}

function executionError(transaction: GenLayerTransaction, status: string) {
  const receipts = transaction.consensus_data?.leader_receipt ?? [];
  const actual = receipts.map((receipt) => safeString(receipt.error)).find(Boolean);
  const execution = transaction.txExecutionResultName ?? 'NOT_REPORTED';
  const result = transaction.resultName ?? 'NOT_REPORTED';
  return {
    code: 'GENLAYER_EXECUTION_FAILED',
    message: actual ?? `GenLayer reported transaction status ${status}, execution result ${execution}, and consensus result ${result}.`,
  };
}

export function classifyGenLayerStatus(status: string, executionResult?: string | null): 'PENDING' | 'FINALIZED' | 'FAILED' {
  if (['CANCELED', 'VALIDATORS_TIMEOUT', 'LEADER_TIMEOUT', 'UNDETERMINED'].includes(status)) return 'FAILED';
  if (status !== 'FINALIZED') return 'PENDING';
  return executionResult === 'FINISHED_WITH_RETURN' ? 'FINALIZED' : 'FAILED';
}

export class LiveGenLayerAdapter implements GenLayerAdapter {
  readonly configured = true;
  readonly network: string;
  readonly contractAddress: `0x${string}`;
  private readonly client;
  private readonly chain;

  constructor(private readonly config: AppConfig) {
    this.chain = chainFor(config);
    this.network = this.chain.name;
    this.contractAddress = config.genlayerContractAddress!;
    this.client = createClient({
      chain: this.chain,
      endpoint: config.genlayerRpc,
      account: createAccount(config.genlayerPrivateKey!),
    });
  }

  async submit(packageJson: string, packageHash: string) {
    const hash = await this.client.writeContract({
      address: this.contractAddress,
      functionName: 'submit_review',
      args: [packageJson, packageHash],
      value: 0n,
      consensusMaxRotations: this.config.genlayerMaxRotations,
    });
    if (typeof hash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error('GenLayer SDK returned a transaction hash in an unsupported format.');
    return hash;
  }

  async poll(transactionHash: string, expected: { reviewId: string; recordId: string; packageHash: string }): Promise<GenLayerPollResult> {
    if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) throw new GenLayerStatusError('INVALID_TRANSACTION_HASH', 'The persisted GenLayer transaction hash is malformed.');
    let transaction: GenLayerTransaction;
    try {
      transaction = await this.client.getTransaction({ hash: transactionHash as SdkTransactionHash });
    } catch (error) {
      throw new GenLayerStatusError('GENLAYER_STATUS_UNAVAILABLE', error instanceof Error ? error.message.slice(0, 1000) : 'The GenLayer RPC status request failed.');
    }

    const status = asStatusName(transaction);
    const execution = transaction.txExecutionResultName;
    const blockReference = safeObject({
      activationBlock: transaction.readStateBlockRange?.activationBlock,
      processingBlock: transaction.readStateBlockRange?.processingBlock,
      proposalBlock: transaction.readStateBlockRange?.proposalBlock,
      statusName: status,
      resultName: transaction.resultName,
      txExecutionResultName: execution,
      numOfRounds: transaction.numOfRounds,
    });

    const consensusState = transaction.resultName ? String(transaction.resultName) : null;
    const chainState = { transactionStatus: status, consensusState, blockReference };
    if (classifyGenLayerStatus(status, execution) === 'FAILED' && status !== 'FINALIZED') {
      const error = executionError(transaction, status);
      return { state: 'FAILED', ...chainState, errorCode: `GENLAYER_${status}`, errorMessage: error.message };
    }
    if (status !== TransactionStatus.FINALIZED) {
      return {
        state: 'PENDING',
        transactionStatus: status,
        consensusState: consensusState,
        blockReference,
      };
    }
    if (execution === ExecutionResult.FINISHED_WITH_ERROR) {
      const error = executionError(transaction, status);
      const trace = await this.readTrace(transactionHash).catch(() => null);
      const traceDetail = trace?.stderr?.trim() ? ` ${trace.stderr.trim().slice(0, 500)}` : '';
      return { state: 'FAILED', transactionStatus: status, consensusState: consensusState, errorCode: error.code, errorMessage: `${error.message}${traceDetail}`.slice(0, 1000), blockReference };
    }
    if (execution !== ExecutionResult.FINISHED_WITH_RETURN) {
      return {
        state: 'FAILED',
        transactionStatus: status,
        consensusState: consensusState,
        errorCode: 'GENLAYER_EXECUTION_RESULT_MISSING',
        errorMessage: `GenLayer reported a finalized transaction with execution result ${String(execution ?? 'NOT_REPORTED')}; no successful return was verified.`,
        blockReference,
      };
    }

    let rawRecord: unknown;
    try {
      rawRecord = await this.client.readContract({
        address: this.contractAddress,
        functionName: 'get_record_by_review',
        args: [expected.reviewId],
        transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      });
    } catch (error) {
      throw new GenLayerStatusError('ONCHAIN_RECORD_READ_FAILED', error instanceof Error ? error.message.slice(0, 1000) : 'The finalized transaction record could not be read from contract storage.', chainState);
    }
    if (typeof rawRecord !== 'string') throw new GenLayerStatusError('INVALID_ONCHAIN_RECORD', 'The finalized contract read did not return the expected JSON string.', chainState);
    let parsed: unknown;
    try { parsed = JSON.parse(rawRecord); }
    catch { throw new GenLayerStatusError('INVALID_ONCHAIN_RECORD', 'The finalized contract read returned malformed JSON.', chainState); }
    const validated = onchainRecordSchema.safeParse(parsed);
    if (!validated.success) throw new GenLayerStatusError('INVALID_ONCHAIN_RECORD', `The finalized contract record failed strict schema validation: ${validated.error.issues.map((issue) => issue.path.join('.')).join(', ')}`, chainState);
    const record = validated.data;
    if (record.review_id !== expected.reviewId || record.record_id !== expected.recordId || record.evidence_package_hash !== expected.packageHash) {
      throw new GenLayerStatusError('ONCHAIN_PROVENANCE_MISMATCH', 'The finalized on-chain record does not match the submitted review, record ID, and evidence package hash.', chainState);
    }
    if (record.decision_source !== 'GENLAYER_INTERPRETATION') throw new GenLayerStatusError('INVALID_ONCHAIN_DECISION_SOURCE', 'The on-chain record does not identify a GenLayer interpretation.', chainState);
    return { state: 'FINALIZED', transactionStatus: status, consensusState: consensusState, record, blockReference };
  }

  async health() {
    try {
      const chainId = await this.client.request({ method: 'eth_chainId' });
      const actual = typeof chainId === 'string' ? BigInt(chainId) : null;
      if (actual !== BigInt(this.chain.id)) {
        return { status: 'CHAIN_ID_MISMATCH', connected: false, network: this.network, contractAddress: this.contractAddress, detail: `The configured RPC reported chain ID ${String(chainId)}; expected ${this.chain.id}.` };
      }
      return { status: 'CONNECTED', connected: true, network: this.network, contractAddress: this.contractAddress, detail: `GenLayer RPC responded on configured network ${this.network}.` };
    } catch (error) {
      const detail = redactConfiguredSecrets(error instanceof Error ? error.message : 'The configured GenLayer RPC request failed.', this.config);
      return { status: 'DISCONNECTED', connected: false, network: this.network, contractAddress: this.contractAddress, detail };
    }
  }

  private async readTrace(hash: string) {
    const trace = await this.client.debugTraceTransaction({ hash: hash as SdkTransactionHash, round: 0 });
    return { stderr: typeof trace.stderr === 'string' ? trace.stderr : '' };
  }
}

export function createGenLayerAdapter(config: AppConfig): GenLayerAdapter {
  return config.genlayerMode === 'live' ? new LiveGenLayerAdapter(config) : new DisabledGenLayerAdapter();
}
