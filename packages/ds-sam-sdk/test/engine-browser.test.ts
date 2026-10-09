const NODE_BUILTINS = [
  'assert',
  'child_process',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'os',
  'path',
  'readline',
  'stream',
  'stream/web',
]

function requireWithoutNodeBuiltins(modulePath: string): Record<string, unknown> {
  let loaded: Record<string, unknown> = {}
  jest.isolateModules(() => {
    for (const name of NODE_BUILTINS) {
      jest.doMock(name, () => {
        throw new Error(`node builtin '${name}' loaded`)
      })
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require(modulePath) as Record<string, unknown>
  })
  return loaded
}

describe('engine entry', () => {
  afterEach(() => {
    for (const name of NODE_BUILTINS) {
      jest.dontMock(name)
    }
  })

  it('loads without any node builtin, including through ds-sam-calc', () => {
    const engine = requireWithoutNodeBuiltins('../src/engine')
    expect(typeof engine.Auction).toBe('function')
    expect(typeof engine.AuctionConstraints).toBe('function')
    expect(typeof engine.buildAuctionConstraintsConfig).toBe('function')
    expect(typeof engine.samIneligibilityGate).toBe('function')
  })

  it('the full sdk index fails under the same guard', () => {
    expect(() => requireWithoutNodeBuiltins('../src')).toThrow(/node builtin '.+' loaded/)
  })
})
