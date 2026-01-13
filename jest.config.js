/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**.test.ts', '<rootDir>/packages/**/test/**.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/packages/.*/dist/'],
  testTimeout: 200000,
}
