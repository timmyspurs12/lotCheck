import { describe, expect, it, vi } from 'vitest';
import { loadConfig, type AppConfig } from '../src/config/env.js';
import { TransactionHashVariant } from 'genlayer-js/types';
import { LiveGenLayerAdapter } from '../src/services/genlayerAdapter.js';

const contractAddress = '0x5c708DF3382123d12eC7110F203653E90f12eC57' as `0x${string}`;
const genlayerTransactionHash = `0x${'a'.repeat(64)}`;
const finalizationEvmTransactionHash = `0x${'b'.repeat(64)}`;
const reviewId = 'c1f84d06-314e-4e40-80d0-b680f392e052';
const recordId = 'ebffc2cf-4fbf-4084-969a-8d53f6f391cd';
const packageHash = '39edd265a3058c80ceea77572197cc98f8faeea7a278eb072f64804d15078f1e';
const projectHash = '7722ad8d3dbbb3c06e81815bd996b8420bc3766dca1f101c4940e2b5341461ea';
const independentHash = 'f67c00df5e296ffb1f221a709cf74368fef0aafbaa00298609325b24fb59d697';

function transaction(statusName: string) {
  return {
    statusName,
    resultName: 'AGREE',
    txExecutionResultName: 'FINISHED_WITH_RETURN',
    readStateBlockRange: { activationBlock: '23716613', processingBlock: '23716628', proposalBlock: '23716630' },
    numOfRounds: '0',
  };
}

const onchainRecord = {
  record_id: recordId,
  review_id: reviewId,
  site_id: 'LOT-47',
  milestone: 'Smoke-test documentary consistency',
  evidence_package_hash: packageHash,
  project_document_hash: projectHash,
  independent_document_hash: independentHash,
  decision: 'ACCEPT',
  reason_code: 'DOCUMENTARY_CONSISTENT',
  summary: 'The two identified sources appear sufficiently consistent on the compared documentary fields under the recorded policy. This is not an environmental safety or compliance certification.',
  material_conflicts: [],
  evidence_references: [projectHash, independentHash],
  policy_version: 'lotcheck-document-review-v1',
  timestamp: '2026-10-07T09:40:43.069Z',
  decision_source: 'GENLAYER_INTERPRETATION',
};

function adapterWith(client: Record<string, unknown>) {
  const base = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/lotcheck_test' });
  const config = {
    ...base,
    genlayerMode: 'live',
    genlayerNetwork: 'testnetBradbury',
    genlayerRpc: 'https://rpc-bradbury.genlayer.com',
    genlayerContractAddress: contractAddress,
  } as unknown as AppConfig;
  return new LiveGenLayerAdapter(config, client as never);
}

function fakeClient(statuses: string[]) {
  const getTransaction = vi.fn();
  for (const status of statuses) getTransaction.mockResolvedValueOnce(transaction(status));
  return {
    getTransaction,
    finalizeTransaction: vi.fn().mockResolvedValue(finalizationEvmTransactionHash),
    readContract: vi.fn().mockResolvedValue(JSON.stringify(onchainRecord)),
    writeContract: vi.fn(),
    request: vi.fn(),
    debugTraceTransaction: vi.fn(),
  };
}

describe('GenLayer worker finalization lifecycle', () => {
  it('finalizes a READY_TO_FINALIZE transaction, rereads FINALIZED status, then verifies the contract record', async () => {
    const client = fakeClient(['READY_TO_FINALIZE', 'FINALIZED']);
    const adapter = adapterWith(client);

    const result = await adapter.poll(genlayerTransactionHash, { reviewId, recordId, packageHash });

    expect(client.finalizeTransaction).toHaveBeenCalledOnce();
    expect(client.finalizeTransaction).toHaveBeenCalledWith({ txId: genlayerTransactionHash });
    expect(client.getTransaction).toHaveBeenCalledTimes(2);
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: contractAddress,
      functionName: 'get_record_by_review',
      args: [reviewId],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    }));
    expect(result).toMatchObject({
      state: 'FINALIZED',
      transactionStatus: 'FINALIZED',
      consensusState: 'AGREE',
      record: {
        record_id: recordId,
        review_id: reviewId,
        evidence_package_hash: packageHash,
        decision: 'ACCEPT',
        reason_code: 'DOCUMENTARY_CONSISTENT',
        decision_source: 'GENLAYER_INTERPRETATION',
      },
      blockReference: { finalizationEvmTransactionHash },
    });
  });

  it('does not finalize during ACCEPTED consensus/finality waiting', async () => {
    const client = fakeClient(['ACCEPTED']);
    const adapter = adapterWith(client);

    const result = await adapter.poll(genlayerTransactionHash, { reviewId, recordId, packageHash });

    expect(result.state).toBe('PENDING');
    expect(result.transactionStatus).toBe('ACCEPTED');
    expect(client.finalizeTransaction).not.toHaveBeenCalled();
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it('keeps transient finalization RPC errors retryable while the transaction remains ready', async () => {
    const client = fakeClient(['READY_TO_FINALIZE', 'READY_TO_FINALIZE']);
    client.finalizeTransaction.mockRejectedValueOnce(new Error('RPC network timeout'));
    const adapter = adapterWith(client);

    await expect(adapter.poll(genlayerTransactionHash, { reviewId, recordId, packageHash })).rejects.toMatchObject({
      code: 'GENLAYER_FINALIZATION_UNAVAILABLE',
      chainState: { transactionStatus: 'READY_TO_FINALIZE' },
    });
  });

  it('persists the finalizer hash while waiting and does not submit a duplicate on the next poll', async () => {
    const client = fakeClient(['READY_TO_FINALIZE', 'READY_TO_FINALIZE', 'READY_TO_FINALIZE']);
    const adapter = adapterWith(client);
    const expected = { reviewId, recordId, packageHash };

    const first = await adapter.poll(genlayerTransactionHash, expected);
    expect(first.state).toBe('PENDING');
    expect(first.blockReference).toMatchObject({ finalizationEvmTransactionHash });

    const second = await adapter.poll(genlayerTransactionHash, {
      ...expected,
      finalizationEvmTransactionHash: first.blockReference?.finalizationEvmTransactionHash as string,
    });

    expect(second.state).toBe('PENDING');
    expect(second.transactionStatus).toBe('READY_TO_FINALIZE');
    expect(second.blockReference).toMatchObject({ finalizationEvmTransactionHash });
    expect(client.finalizeTransaction).toHaveBeenCalledOnce();
  });
});
