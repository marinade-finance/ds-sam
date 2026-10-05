import axios from 'axios'

import type { RawAlpenglowGenesisDto } from './data-provider.dto'
import type { AlpenglowMigration } from '@marinade.finance/ds-sam-calc'

type JsonRpcResponse<T> = { result?: T; error?: { code: number; message: string } }

type EpochScheduleResult = {
  slotsPerEpoch: number
  firstNormalEpoch: number
  firstNormalSlot: number
}

// null until the first Alpenglow block
type AgGenesisCertResult = { block: { slot: number } } | null

const RPC_TIMEOUT_MS = 30_000

async function rpcCall<T>(rpcUrl: string, method: string): Promise<T> {
  const response = await axios.post<JsonRpcResponse<T>>(
    rpcUrl,
    { jsonrpc: '2.0', id: 1, method, params: [] },
    { timeout: RPC_TIMEOUT_MS },
  )
  const { result, error } = response.data
  if (error) {
    throw new Error(`RPC ${method} at ${rpcUrl} failed: ${error.code} ${error.message}`)
  }
  if (result === undefined) {
    throw new Error(`RPC ${method} at ${rpcUrl} returned no result`)
  }
  return result
}

function requireSlot(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${name} from RPC: ${JSON.stringify(value)}`)
  }
  return value
}

export async function fetchAlpenglowGenesis(rpcUrl: string): Promise<RawAlpenglowGenesisDto> {
  const [schedule, cert] = await Promise.all([
    rpcCall<EpochScheduleResult>(rpcUrl, 'getEpochSchedule'),
    rpcCall<AgGenesisCertResult>(rpcUrl, 'getAgGenesisCert'),
  ])
  return {
    genesis_cert_slot: cert === null ? null : requireSlot(cert.block?.slot, 'getAgGenesisCert block.slot'),
    slots_per_epoch: requireSlot(schedule.slotsPerEpoch, 'slotsPerEpoch'),
    first_normal_epoch: requireSlot(schedule.firstNormalEpoch, 'firstNormalEpoch'),
    first_normal_slot: requireSlot(schedule.firstNormalSlot, 'firstNormalSlot'),
  }
}

export function alpenglowMigration(genesis: RawAlpenglowGenesisDto): AlpenglowMigration | null {
  const {
    genesis_cert_slot: slot,
    slots_per_epoch: slotsPerEpoch,
    first_normal_epoch: firstNormalEpoch,
    first_normal_slot: firstNormalSlot,
  } = genesis
  if (slot === null) {
    return null
  }
  if (slotsPerEpoch <= 0) {
    throw new Error(`Invalid slots per epoch: ${slotsPerEpoch}`)
  }
  if (slot < firstNormalSlot) {
    throw new Error(`Alpenglow genesis slot ${slot} falls in the warmup epochs, which are not supported`)
  }
  const epochOffset = Math.floor((slot - firstNormalSlot) / slotsPerEpoch)
  const epochFirstSlot = firstNormalSlot + epochOffset * slotsPerEpoch
  return {
    epoch: firstNormalEpoch + epochOffset,
    towerEpochShareDec: (slot - epochFirstSlot) / slotsPerEpoch,
  }
}
