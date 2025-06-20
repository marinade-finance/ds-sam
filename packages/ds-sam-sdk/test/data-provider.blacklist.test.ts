import { DataProvider } from '../src/data-provider/data-provider'
import { DEFAULT_CONFIG, InputsSource } from '../src/config'

describe('DataProvider.aggregateData blacklist flags', () => {
  it('marks samBlacklisted from CSV and default lastSamBlacklisted to false', () => {
    // minimal raw data with three validators: alice, bob, carol
    const raw: any = {
      validators: {
        validators: [
          { vote_account: 'alice', activated_stake: '0', marinade_stake: '0', marinade_native_stake: '0',
            dc_country: null, dc_aso: null, version: null, commission_effective: null, commission_advertised: 0,
            credits: 0, epoch_stats: []
          },
          { vote_account: 'bob', activated_stake: '0', marinade_stake: '0', marinade_native_stake: '0',
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
      bonds: { bonds: [] },
      tvlInfo: { total_virtual_staked_sol: 1, marinade_native_stake_sol: 0 },
      blacklist: \`vote_account,reason
alice,reason
carol,reason
\`,
      mndeVotes: { voteRecordsCreatedAt: '', records: [] },
      rewards: { rewards_inflation_est: [[1, 1]], rewards_mev: [[1, 1]] },
      auctions: [],
      overrides: null
    }

    const cfg = { ...DEFAULT_CONFIG, inputsSource: InputsSource.FILES, inputsCacheDirPath: '/tmp' }
    const dp = new DataProvider(cfg, InputsSource.FILES)
    const aggregated = dp.aggregateData(raw, null)
    const flags = aggregated.validators.map(v => ({
      voteAccount: v.voteAccount,
      samBlacklisted: v.values.samBlacklisted,
      lastSamBlacklisted: v.lastSamBlacklisted
    }))
    expect(flags).toMatchSnapshot()
  })
})
