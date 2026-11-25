import { blacklistRulesEpochs } from '../src/blacklist/evaluate'

const A = 1085

describe('blacklistRulesEpochs', () => {
  it('reads the windows ending at the last two closed epochs', () => {
    expect(blacklistRulesEpochs({ maxNewListings: 10, sandwich: { ratePct: 4 } }, A)).toEqual([1083, 1084])
    expect(
      blacklistRulesEpochs({ maxNewListings: 10, slowSlots: { medianMult: 1.1, consecutiveEpochs: 2 } }, A),
    ).toEqual([1082, 1083, 1084])
    expect(
      blacklistRulesEpochs(
        { maxNewListings: 10, sandwich: { ratePct: 4 }, slowSlots: { medianMult: 1.1, consecutiveEpochs: 2 } },
        A,
      ),
    ).toEqual([1082, 1083, 1084])
  })

  it('reads nothing without a rule', () => {
    expect(blacklistRulesEpochs({ maxNewListings: 10 }, A)).toEqual([])
  })
})
