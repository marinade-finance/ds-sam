import fs from 'fs'
import path from 'path'

import { CommandFactory } from 'nest-commander'

import { CliModule } from '../src/cli.module'
import { AnalyzeRevenuesCommand } from '../src/commands/analyze-revenue.cmd'
import { Logger } from '../src/logger'

const FIXTURES = path.join(__dirname, 'fixtures')
const SAM_RUN = path.join(FIXTURES, 'sam-run-1')

const resolveCommand = async (): Promise<AnalyzeRevenuesCommand> => {
  const commandFactory = await CommandFactory.createWithoutRunning(CliModule, new Logger())
  return commandFactory.resolve(AnalyzeRevenuesCommand)
}

// byte-level guard of evaluation.json as validator-bonds consumes it; the jest snapshot sorts keys
describe('analyze-revenues golden output', () => {
  it('serializes the no-past collection byte-identically', async () => {
    const cmd = await resolveCommand()
    const collection = await cmd.getRevenueExpectationCollection({
      inputsCacheDirPath: path.join(SAM_RUN, 'inputs'),
      samResultsFixtureFilePath: path.join(SAM_RUN, 'outputs', 'results.json'),
      snapshotValidatorsFilePath: path.join(FIXTURES, '650_validators.json'),
    })
    const golden = fs.readFileSync(path.join(SAM_RUN, 'outputs', 'evaluation.golden.json')).toString()
    expect(JSON.stringify(collection, null, 2) === golden).toBe(true)
  })
})
