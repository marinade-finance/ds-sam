import { DataProvider } from '../src/data-provider/data-provider'
import { DEFAULT_CONFIG, InputsSource } from '../src/config'

describe('DataProvider.aggregateData blacklist flags', () => {
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
    mevInfo: { validators: [] },
    bonds:    { bonds: [] },
    tvlInfo:  { total_virtual_staked_sol: 1, marinade_native_stake_sol: 0 },
    mndeVotes:{ voteRecordsCreatedAt: '', records: [] },
    rewards:  { rewards_inflation_est: [[1, 1]], rewards_mev: [[1, 1]] },
    auctions: [],
    overrides:null as null
  }

  function makeProviderWithCsv(csv: string) {
    const raw = { ...baseRaw, blacklist: csv }
    const cfg = {
      ...DEFAULT_CONFIG,
      inputsSource: InputsSource.FILES,
      inputsCacheDirPath: '/tmp',
    }
    const dp = new DataProvider(cfg, InputsSource.FILES)
    return dp.aggregateData(raw as any, null)
  }

  it('initial CSV: alice & carol blacklisted, bob not', () => {
    const csv = [
      'vote_account,reason',
      'alice,spam',
      'carol,spam',
    ].join('\n')
    const aggregated = makeProviderWithCsv(csv)
    const flags = aggregated.validators.map(v => ({
      voteAccount:        v.voteAccount,
      samBlacklisted:     v.values.samBlacklisted,
      lastSamBlacklisted: v.lastSamBlacklisted,
    }))
    expect(flags).toMatchSnapshot()
  })

  it('updated CSV: only bob blacklisted now', () => {
    const csv = [
      'vote_account,reason',
      'bob,spam',
    ].join('\n')
    const aggregated = makeProviderWithCsv(csv)
    const flags = aggregated.validators.map(v => ({
      voteAccount:        v.voteAccount,
      samBlacklisted:     v.values.samBlacklisted,
      lastSamBlacklisted: v.lastSamBlacklisted,
    }))
    expect(flags).toMatchSnapshot()
  })
})
