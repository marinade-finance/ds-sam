import { CommandFactory } from "nest-commander"
import { CliModule } from '../src/cli.module'
import { Logger } from '../src/logger'
import { AnalyzeRevenuesCommand } from "../src/commands/analyze-revenue.cmd"
import path from "path"

describe('revenue analysis', () => {
  describe('running the whole flow', () => {
    it('evaluates revenues correctly', async () => {
      const commandFactory = await CommandFactory.createWithoutRunning(CliModule, new Logger())
      const cmd = await commandFactory.resolve(AnalyzeRevenuesCommand)
      // to debug, find validators who have expected pmpe <> actual pmpe and see if they actually changed commission and vice versa
      expect(await cmd.getRevenueExpectationCollection({
        inputsCacheDirPath: path.join(__dirname, 'fixtures', 'sam-run-1', 'inputs'),
        samResultsFixtureFilePath: path.join(__dirname, 'fixtures', 'sam-run-1', 'outputs', 'results.json'),
        snapshotValidatorsFilePath: path.join(__dirname, 'fixtures', '650_validators.json'),
      })).toMatchSnapshot()
    })
  })
})
