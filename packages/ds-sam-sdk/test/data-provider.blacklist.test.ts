/**
 * DataProvider.aggregateData blacklist flag handling covers:
 * - no CSV & no history: no blacklisting
 * - CSV only: CSV-driven samBlacklisted; lastSamBlacklisted false
 * - history only: history-driven lastSamBlacklisted; samBlacklisted false
 * - disjoint CSV & history: flags drawn from correct sources
 * - overlapping CSV & history: both flags true for overlapping accounts
 */
import { DataProvider } from '../src/data-provider/data-provider'
import { DEFAULT_CONFIG, InputsSource } from '../src/config'

describe('DataProvider.aggregateData blacklist flag handling', () => {
  const baseRaw = {
    validators: {
      validators: [
        { vote_account: 'alice', activated_stake: '0', marinade_stake: '0', marinade_native_stake: '0',
          dc_country: null, dc_aso: null, version: null, commission_effective: null, commission_advertised: 0,
          credits: 0, epoch_stats: []
        },
        { vote_account: 'bob',   activated_stake: '0', marinade_stake: '0', marinade_native_stake: '0',
          dc_country: null, dc_aso: null, version: null, commission_effective: null, commission_advertised: 0,
          credits: 0, epoch_stats: []
        },
        { vote_account: 'carol', activated_stake: '0', marinade_stake: '0', marinade_native_stake: '0',
          dc_country: null, dc_aso: null, version: null, commission_effective: null, commission_advertised: 0,
          credits: 0, epoch_stats: []
        },
      ]
    },
    mevInfo:   { validators: [] },
    bonds:     { bonds: [] },
    tvlInfo:   { total_virtual_staked_sol: 1, marinade_native_stake_sol: 0 },
    mndeVotes: { voteRecordsCreatedAt: '', records: [] },
    rewards:   { rewards_inflation_est: [[1, 1]], rewards_mev: [[1, 1]] },
    overrides: null as null,
  }

  function runAggregate(csv: string, history: any[] = []) {
    const raw = { ...baseRaw, blacklist: csv, auctions: history }
    const cfg = { ...DEFAULT_CONFIG, inputsSource: InputsSource.FILES, inputsCacheDirPath: '/tmp' }
    const dp = new DataProvider(cfg, InputsSource.FILES)
    return dp.aggregateData(raw as any, null)
  }

  function extractFlags(agg: ReturnType<typeof runAggregate>) {
    return agg.validators.map(v => ({
      voteAccount:        v.voteAccount,
      samBlacklisted:     v.values.samBlacklisted,
      lastSamBlacklisted: v.lastSamBlacklisted,
    }))
  }

  it('no CSV & no history → nobody is blacklisted', () => {
    const flags = extractFlags(runAggregate('vote_account,reason'))
    expect(flags).toEqual([
      { voteAccount: 'alice', samBlacklisted: false, lastSamBlacklisted: false },
      { voteAccount: 'bob',   samBlacklisted: false, lastSamBlacklisted: false },
      { voteAccount: 'carol', samBlacklisted: false, lastSamBlacklisted: false },
    ])
  })

  it('CSV only → samBlacklisted from CSV; lastSamBlacklisted always false', () => {
    const csv = ['vote_account,reason','alice,spam','carol,spam'].join('\n')
    const flags = extractFlags(runAggregate(csv))
    expect(flags).toEqual([
      { voteAccount: 'alice', samBlacklisted: true,  lastSamBlacklisted: false },
      { voteAccount: 'bob',   samBlacklisted: false, lastSamBlacklisted: false },
      { voteAccount: 'carol', samBlacklisted: true,  lastSamBlacklisted: false },
    ])
  })

  it('history only → history-driven lastSamBlacklisted; samBlacklisted false', () => {
    const history = [{
      voteAccount: 'bob',
      revShare: { inflationPmpe: 0, mevPmpe: 0, bidPmpe: 0, totalPmpe: 0 },
      marinadeSamTargetSol: 0,
      marinadeMndeTargetSol: 0,
      epoch: 0,
      values: { samBlacklisted: true },
    }]
    const flags = extractFlags(runAggregate('vote_account,reason', history))
    expect(flags).toEqual([
      { voteAccount: 'alice', samBlacklisted: false, lastSamBlacklisted: false },
      { voteAccount: 'bob',   samBlacklisted: false, lastSamBlacklisted: true },
      { voteAccount: 'carol', samBlacklisted: false, lastSamBlacklisted: false },
    ])
  })

  it('disjoint CSV & history → correct flags from each', () => {
    const csv = ['vote_account,reason','alice,spam'].join('\n')
    const history = [{
      voteAccount: 'bob',
      revShare: { inflationPmpe: 0, mevPmpe: 0, bidPmpe: 0, totalPmpe: 0 },
      marinadeSamTargetSol: 0,
      marinadeMndeTargetSol: 0,
      epoch: 0,
      values: { samBlacklisted: true },
    }]
    const flags = extractFlags(runAggregate(csv, history))
    expect(flags).toEqual([
      { voteAccount: 'alice', samBlacklisted: true,  lastSamBlacklisted: false },
      { voteAccount: 'bob',   samBlacklisted: false, lastSamBlacklisted: true  },
      { voteAccount: 'carol', samBlacklisted: false, lastSamBlacklisted: false },
    ])
  })

  it('overlapping CSV & history → both flags true for overlapping', () => {
    const csv = ['vote_account,reason','carol,spam'].join('\n')
    const history = [{
      voteAccount: 'carol',
      revShare: { inflationPmpe: 0, mevPmpe: 0, bidPmpe: 0, totalPmpe: 0 },
      marinadeSamTargetSol: 0,
      marinadeMndeTargetSol: 0,
      epoch: 0,
      values: { samBlacklisted: true },
    }]
    const flags = extractFlags(runAggregate(csv, history))
    expect(flags).toEqual([
      { voteAccount: 'alice', samBlacklisted: false, lastSamBlacklisted: false },
      { voteAccount: 'bob',   samBlacklisted: false, lastSamBlacklisted: false },
      { voteAccount: 'carol', samBlacklisted: true,  lastSamBlacklisted: true  },
    ])
  })
})
