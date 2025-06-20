import { DataProvider } from '../src/data-provider/data-provider'
import { DEFAULT_CONFIG, InputsSource } from '../src/config'

describe('DataProvider.aggregateData → lastSamBlacklisted from prior auctions', () => {
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

  function runAggregate(blacklistCsv: string, auctions: any[]) {
    const raw = {
      ...baseRaw,
      blacklist: blacklistCsv,
      auctions,
    }
    const cfg = {
      ...DEFAULT_CONFIG,
      inputsSource: InputsSource.FILES,
      inputsCacheDirPath: '/tmp',
    }
    const dp = new DataProvider(cfg, InputsSource.FILES)
    return dp.aggregateData(raw as any, null)
  }

  it('reads lastSamBlacklisted = true for alice & carol from prior auctions', () => {
    // current CSV blacklists only bob
    const csv = ['vote_account', 'bob'].join('\n')

    // inject a “prior auction” where alice and carol were blacklisted
    const auctions = [
      {
        voteAccount: 'alice',
        revShare: { bidPmpe: 0, inflationPmpe: 0, mevPmpe: 0, totalPmpe: 0 },
        marinadeSamTargetSol: 0,
        marinadeMndeTargetSol: 0,
        epoch: 0,
        // this values object is preserved through processAuctions()
        values: { samBlacklisted: true },
      },
      {
        voteAccount: 'bob',
        revShare: { bidPmpe: 0, inflationPmpe: 0, mevPmpe: 0, totalPmpe: 0 },
        marinadeSamTargetSol: 0,
        marinadeMndeTargetSol: 0,
        epoch: 0,
        values: { samBlacklisted: false },
      },
      {
        voteAccount: 'carol',
        revShare: { bidPmpe: 0, inflationPmpe: 0, mevPmpe: 0, totalPmpe: 0 },
        marinadeSamTargetSol: 0,
        marinadeMndeTargetSol: 0,
        epoch: 0,
        values: { samBlacklisted: true },
      },
    ]

    const agg = runAggregate(csv, auctions)
    const flags = agg.validators.map(v => ({
      voteAccount:        v.voteAccount,
      samBlacklisted:     v.values.samBlacklisted,
      lastSamBlacklisted: v.lastSamBlacklisted,
    }))
    expect(flags).toMatchSnapshot()
  })

  it('if no prior auction entry, lastSamBlacklisted defaults to false', () => {
    // current CSV blacklists only alice
    const csv = ['vote_account', 'alice'].join('\n')
    // prior auctions mention only bob
    const auctions = [
      {
        voteAccount: 'bob',
        revShare: { bidPmpe: 0, inflationPmpe: 0, mevPmpe: 0, totalPmpe: 0 },
        marinadeSamTargetSol: 0,
        marinadeMndeTargetSol: 0,
        epoch: 0,
        values: { samBlacklisted: true },
      },
    ]

    const agg = runAggregate(csv, auctions)
    const flags = agg.validators.map(v => ({
      voteAccount:        v.voteAccount,
      samBlacklisted:     v.values.samBlacklisted,
      lastSamBlacklisted: v.lastSamBlacklisted,
    }))
    expect(flags).toMatchSnapshot()
  })
})
