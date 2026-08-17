// Tests for epochDurationSeconds: every agave slot-params row must come back as
// SLOTS_PER_EPOCH × its slot time, which is the seconds basis ts-common's apy functions take.
import { epochDurationSeconds, SLOTS_PER_EPOCH } from '../src/constants'

// [slot time ms, agave's slots_per_year for that regime]
const AGAVE_SLOT_PARAMS: [number, number][] = [
  [400, 78_892_314.984],
  [350, 90_162_645.696],
  [300, 105_189_753.312],
  [250, 126_227_703.974],
  [200, 157_784_629.968],
]

describe('epochDurationSeconds', () => {
  it.each(AGAVE_SLOT_PARAMS)('resolves the %dms regime to its wall-clock epoch', (slotTimeMs, slotsPerYear) => {
    const expected = (SLOTS_PER_EPOCH * slotTimeMs) / 1000
    expect(epochDurationSeconds({ slotsPerYear, epoch: 1000 })).toBeCloseTo(expected, 3)
  })

  it('resolves the 400ms regime to exactly 48 hours', () => {
    expect(epochDurationSeconds({ slotsPerYear: 78_892_314.984, epoch: 1000 })).toBeCloseTo(48 * 3600, 6)
  })

  it.each([0, -1, NaN])('rejects %p as slotsPerYear', slotsPerYear => {
    expect(() => epochDurationSeconds({ slotsPerYear, epoch: 1000 })).toThrow(/slotsPerYear must be positive/)
  })
})
