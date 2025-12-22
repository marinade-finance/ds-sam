const createSharedConfig = require('@marinade.finance/eslint-config')

const sharedConfig = createSharedConfig({})

module.exports = [
  ...sharedConfig,
  {
    ignores: ['test/__snapshots__/**', 'test/fixtures/**'],
  },
  {
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      'no-await-in-loop': 'off',
      'no-param-reassign': 'off',
    },
  },
]
