import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccount, createClient } from 'genlayer-js';
import { testnetAsimov, testnetBradbury } from 'genlayer-js/chains';
import { TransactionHashVariant, TransactionStatus } from 'genlayer-js/types';

const SDK_VERSION = 'genlayer-js@1.1.8';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = resolve(repositoryRoot, 'contracts/lotcheck_review.py');
const supportedNetworks = {
  testnetBradbury,
  testnetAsimov,
};

function configurationError(messages) {
  const detail = messages.map((message) => `- ${message}`).join('\n');
  return new Error(`GenLayer deployment configuration error:\n${detail}`);
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function errorDetail(error, privateKey) {
  const parts = [];
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    for (const key of ['shortMessage', 'details', 'message', 'code', 'data']) {
      const value = current?.[key];
      if (value !== undefined && value !== null) {
        parts.push(typeof value === 'string' ? value : JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));
      }
    }
    current = current?.cause;
  }
  if (parts.length === 0) parts.push(String(error));
  let detail = [...new Set(parts)].join('\n');
  if (privateKey) detail = detail.split(privateKey).join('[REDACTED]');
  return detail.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').slice(0, 12_000);
}

function emitFailure({ stage, network, chainId, rpc, deploymentTx, privateKey, error }) {
  const output = {
    deployment_status: 'FAILED_OR_NOT_SUBMITTED',
    failure_stage: stage,
    network: network ?? null,
    chain_id: chainId ?? null,
    sdk: SDK_VERSION,
    rpc: rpc ?? null,
    deployment_tx: deploymentTx ?? null,
    error: errorDetail(error, privateKey),
    retry_guidance: deploymentTx
      ? 'Do not redeploy. Resume investigation of this transaction hash and its final status first.'
      : 'No GenLayer transaction hash was returned. Do not switch networks automatically; resolve this exact failure first.',
  };
  console.error(JSON.stringify(output, null, 2));
}

async function main() {
  const networkName = process.env.GENLAYER_NETWORK?.trim();
  const rpc = process.env.GENLAYER_RPC?.trim();
  const privateKey = process.env.GENLAYER_PRIVATE_KEY?.trim();
  const existingAddress = process.env.GENLAYER_CONTRACT_ADDRESS?.trim();
  const configErrors = [];

  if (!networkName) configErrors.push('GENLAYER_NETWORK must be set explicitly.');
  if (networkName && !Object.hasOwn(supportedNetworks, networkName)) {
    configErrors.push('This deployment command only supports the stable public testnets testnetBradbury and testnetAsimov.');
  }
  if (!rpc) configErrors.push('GENLAYER_RPC must be set explicitly to the selected network’s canonical RPC.');
  if (rpc && networkName && Object.hasOwn(supportedNetworks, networkName)) {
    const chain = supportedNetworks[networkName];
    if (canonicalUrl(rpc) !== canonicalUrl(chain.rpcUrls.default.http[0])) {
      configErrors.push(`GENLAYER_RPC must match ${networkName}’s canonical RPC (${chain.rpcUrls.default.http[0]}).`);
    }
  }
  if (!privateKey) configErrors.push('GENLAYER_PRIVATE_KEY is missing; inject a funded signer through a secret manager. No key will be generated.');
  else if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) configErrors.push('GENLAYER_PRIVATE_KEY must be a 32-byte 0x-prefixed hex key.');
  if (existingAddress) configErrors.push('GENLAYER_CONTRACT_ADDRESS is already set; refusing to create a duplicate deployment.');
  const maxRotationsRaw = process.env.GENLAYER_MAX_ROTATIONS ?? '3';
  const maxRotations = Number(maxRotationsRaw);
  if (!Number.isInteger(maxRotations) || maxRotations < 0 || maxRotations > 10) {
    configErrors.push('GENLAYER_MAX_ROTATIONS must be an integer from 0 through 10.');
  }
  if (configErrors.length) {
    emitFailure({
      stage: 'CONFIGURATION',
      network: networkName,
      chainId: null,
      rpc,
      deploymentTx: null,
      privateKey,
      error: configurationError(configErrors),
    });
    process.exitCode = 2;
    return;
  }

  const chain = supportedNetworks[networkName];
  const account = createAccount(privateKey);
  const client = createClient({ chain, endpoint: rpc, account });

  let stage = 'RPC_CHAIN_PREFLIGHT';
  let deploymentTx = null;
  let observedChainId = null;
  try {
    console.log(JSON.stringify({
      operation: 'deploy_lotcheck_review_contract',
      network: chain.name,
      chain_id_expected: chain.id,
      sdk: SDK_VERSION,
      signer_address: account.address,
      rpc,
      contract_source: contractPath,
      max_rotations: maxRotations,
    }, null, 2));

    const chainIdHex = await client.request({ method: 'eth_chainId' });
    observedChainId = typeof chainIdHex === 'string' ? Number(BigInt(chainIdHex)) : null;
    if (observedChainId !== chain.id) {
      throw new Error(`RPC chain ID mismatch: received ${String(chainIdHex)}, expected ${chain.id}.`);
    }

    stage = 'CONTRACT_SCHEMA_PREFLIGHT';
    const code = await readFile(contractPath, 'utf8');
    const schema = await client.getContractSchemaForCode(code);
    const methods = Object.keys(schema?.methods ?? {}).sort();
    const requiredMethods = ['get_record_by_review', 'get_record_count', 'submit_review'];
    const missingMethods = requiredMethods.filter((method) => !methods.includes(method));
    if (missingMethods.length) {
      throw new Error(`Remote schema preflight omitted required LotCheck methods: ${missingMethods.join(', ')}.`);
    }
    console.log(JSON.stringify({ stage, contract_source_bytes: Buffer.byteLength(code), schema_methods: methods }));

    stage = 'DEPLOYMENT_SUBMISSION';
    deploymentTx = await client.deployContract({
      code,
      args: [],
      leaderOnly: false,
      consensusMaxRotations: maxRotations,
    });
    if (typeof deploymentTx !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(deploymentTx)) {
      throw new Error('GenLayer SDK returned an unsupported deployment transaction hash.');
    }
    console.log(JSON.stringify({ stage: 'DEPLOYMENT_SUBMITTED', deployment_tx: deploymentTx, network: chain.name, chain_id: chain.id }));

    stage = 'DEPLOYMENT_FINALITY';
    await client.waitForTransactionReceipt({
      hash: deploymentTx,
      status: TransactionStatus.FINALIZED,
      interval: 5_000,
      retries: 120,
    });
    const transaction = await client.getTransaction({ hash: deploymentTx });
    if (transaction.statusName !== 'FINALIZED' || transaction.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
      throw new Error(`Deployment did not finalize successfully: status=${String(transaction.statusName)}, execution=${String(transaction.txExecutionResultName)}.`);
    }
    if (transaction.txDataDecoded?.type !== 'deploy') {
      throw new Error(`Finalized transaction is not decoded as a deployment (type=${String(transaction.txDataDecoded?.type)}).`);
    }

    const contractAddress = transaction.txDataDecoded?.contractAddress ?? transaction.recipient ?? transaction.to_address;
    if (typeof contractAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
      throw new Error('Finalized deployment receipt did not contain a valid contract address.');
    }

    stage = 'CONTRACT_READABILITY_VERIFICATION';
    const deployedSchema = await client.getContractSchema(contractAddress);
    const deployedMethods = Object.keys(deployedSchema?.methods ?? {}).sort();
    const missingDeployedMethods = requiredMethods.filter((method) => !deployedMethods.includes(method));
    if (missingDeployedMethods.length) {
      throw new Error(`Deployed contract schema is missing methods: ${missingDeployedMethods.join(', ')}.`);
    }
    const recordCount = await client.readContract({
      address: contractAddress,
      functionName: 'get_record_count',
      args: [],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    });
    if (!(typeof recordCount === 'number' || typeof recordCount === 'bigint') || Number(recordCount) !== 0) {
      throw new Error(`Newly deployed LotCheck record count was not readable as zero (received ${String(recordCount)}).`);
    }

    console.log(JSON.stringify({
      deployment_status: 'FINALIZED_AND_READABLE',
      network: chain.name,
      chain_id: chain.id,
      sdk: SDK_VERSION,
      signer_address: account.address,
      deployment_tx: deploymentTx,
      final_status: transaction.statusName,
      execution_result: transaction.txExecutionResultName,
      contract_address: contractAddress,
      verified_methods: deployedMethods,
      read_verification: { function: 'get_record_count', value: Number(recordCount) },
      next_configuration: `Set GENLAYER_CONTRACT_ADDRESS=${contractAddress} in the backend secret/config store.`,
    }, null, 2));
  } catch (error) {
    emitFailure({
      stage,
      network: chain.name,
      chainId: observedChainId ?? chain.id,
      rpc,
      deploymentTx,
      privateKey,
      error,
    });
    process.exitCode = 1;
  }
}

main().catch((error) => {
  emitFailure({
    stage: 'SCRIPT_STARTUP',
    network: process.env.GENLAYER_NETWORK ?? null,
    chainId: null,
    rpc: process.env.GENLAYER_RPC ?? null,
    deploymentTx: null,
    privateKey: process.env.GENLAYER_PRIVATE_KEY,
    error,
  });
  process.exitCode = 1;
});
