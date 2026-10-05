import axios from 'axios'

import { alpenglowMigration, fetchAlpenglowGenesis } from '../src/data-provider/alpenglow-genesis'

const RPC_URL = 'http://rpc.test'

const SCHEDULE = { slotsPerEpoch: 432_000, firstNormalEpoch: 0, firstNormalSlot: 0, warmup: false }

const mockRpc = (responses: Record<string, unknown>) =>
  jest.spyOn(axios, 'post').mockImplementation((_url, body) => {
    const { method } = body as { method: string }
    if (!(method in responses)) {
      throw new Error(`unexpected RPC method ${method}`)
    }
    return Promise.resolve({ data: responses[method] })
  })

describe('alpenglow genesis', () => {
  afterEach(() => jest.restoreAllMocks())

  it('reads the first Alpenglow slot and the epoch schedule', async () => {
    mockRpc({
      getEpochSchedule: { result: SCHEDULE },
      getAgGenesisCert: { result: { block: { slot: 449_928_000 + 4_999 } } },
    })

    await expect(fetchAlpenglowGenesis(RPC_URL)).resolves.toEqual({
      genesis_cert_slot: 449_932_999,
      slots_per_epoch: 432_000,
      first_normal_epoch: 0,
      first_normal_slot: 0,
    })
  })

  it('gives a null slot before the migration', async () => {
    mockRpc({ getEpochSchedule: { result: SCHEDULE }, getAgGenesisCert: { result: null } })

    await expect(fetchAlpenglowGenesis(RPC_URL)).resolves.toMatchObject({ genesis_cert_slot: null })
  })

  it('throws when the RPC does not serve getAgGenesisCert', async () => {
    mockRpc({
      getEpochSchedule: { result: SCHEDULE },
      getAgGenesisCert: { error: { code: -32601, message: 'Method not found' } },
    })

    await expect(fetchAlpenglowGenesis(RPC_URL)).rejects.toThrow(
      `RPC getAgGenesisCert at ${RPC_URL} failed: -32601 Method not found`,
    )
  })

  it('throws when the HTTP call fails', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue(new Error('connect ECONNREFUSED'))

    await expect(fetchAlpenglowGenesis(RPC_URL)).rejects.toThrow('connect ECONNREFUSED')
  })

  it('throws on a malformed slot', async () => {
    mockRpc({ getEpochSchedule: { result: SCHEDULE }, getAgGenesisCert: { result: { block: {} } } })

    await expect(fetchAlpenglowGenesis(RPC_URL)).rejects.toThrow('Invalid getAgGenesisCert block.slot from RPC')
  })

  it('maps the slot to the migration epoch and its tower share', () => {
    expect(
      alpenglowMigration({
        genesis_cert_slot: 1042 * 432_000 + 108_000,
        slots_per_epoch: 432_000,
        first_normal_epoch: 0,
        first_normal_slot: 0,
      }),
    ).toEqual({ epoch: 1042, towerEpochShareDec: 0.25 })
  })

  it('applies the first normal epoch of the schedule', () => {
    // Devnet-shaped schedule: 14 warmup epochs ending at slot 524,256
    expect(
      alpenglowMigration({
        genesis_cert_slot: 524_256 + 3 * 432_000 + 43_200,
        slots_per_epoch: 432_000,
        first_normal_epoch: 14,
        first_normal_slot: 524_256,
      }),
    ).toEqual({ epoch: 17, towerEpochShareDec: 0.1 })
  })

  it('gives no migration before the cluster migrates', () => {
    expect(
      alpenglowMigration({
        genesis_cert_slot: null,
        slots_per_epoch: 432_000,
        first_normal_epoch: 0,
        first_normal_slot: 0,
      }),
    ).toBeNull()
  })
})
