import path from 'path'

import { CommandFactory } from 'nest-commander'

import { CliModule } from '../src/cli.module'
import { AnalyzeRevenuesCommand } from '../src/commands/analyze-revenue.cmd'
import { Logger } from '../src/logger'

describe('revenue analysis', () => {
  describe('running the whole flow', () => {
    it('evaluates revenues correctly', async () => {
      const commandFactory = await CommandFactory.createWithoutRunning(CliModule, new Logger())
      const cmd = await commandFactory.resolve(AnalyzeRevenuesCommand)
      // to debug, find validators who have expected pmpe <> actual pmpe and see if they actually changed commission and vice versa
      expect(
        await cmd.getRevenueExpectationCollection({
          inputsCacheDirPath: path.join(__dirname, 'fixtures', 'sam-run-1', 'inputs'),
          samResultsFixtureFilePath: path.join(__dirname, 'fixtures', 'sam-run-1', 'outputs', 'results.json'),
          snapshotValidatorsFilePath: path.join(__dirname, 'fixtures', '650_validators.json'),
        }),
      ).toMatchSnapshot()
    })

    it('evaluates revenues correctly with reputation limits enabled', async () => {
      const commandFactory = await CommandFactory.createWithoutRunning(CliModule, new Logger())
      const cmd = await commandFactory.resolve(AnalyzeRevenuesCommand)
      // to debug, find validators who have expected pmpe <> actual pmpe and see if they actually changed commission and vice versa
      expect(
        await cmd.getRevenueExpectationCollection({
          inputsCacheDirPath: path.join(__dirname, 'fixtures', 'sam-run-2', 'inputs'),
          samResultsFixtureFilePath: path.join(__dirname, 'fixtures', 'sam-run-2', 'outputs', 'results.json'),
          snapshotValidatorsFilePath: path.join(__dirname, 'fixtures', '796_validators.json'),
        }),
      ).toMatchSnapshot()
    })
  })
})
