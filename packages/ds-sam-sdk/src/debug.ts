import { LogVerbosity } from './config'

export class Debug {
  private infos: [string, string][] = []
  private events: string[] = []
  private logger: Logger

  constructor(
    private readonly voteAccounts: Set<string>,
    public readonly logVerbosity: LogVerbosity = LogVerbosity.DEBUG,
  ) {
    this.logger = new Logger(logVerbosity)
  }

  getVoteAccounts() {
    return this.voteAccounts
  }

  pushInfo(context: string, info: string) {
    this.infos.push([context, info])
  }

  pushValidatorInfo(voteAccount: string, context: string, info: string) {
    if (this.voteAccounts.has(voteAccount)) {
      this.infos.push([context, `${voteAccount} ${info}`])
    }
  }

  pushEvent(event: string) {
    this.events.push(event)
  }

  pushValidatorEvent(voteAccount: string, event: string) {
    if (this.voteAccounts.has(voteAccount)) {
      this.events.push(`${voteAccount} ${event}`)
    }
  }

  pushValidatorSetEvent(voteAccounts: Set<string>, event: string) {
    this.voteAccounts.forEach(debugVoteAccount => {
      if (voteAccounts.has(debugVoteAccount)) {
        this.pushValidatorEvent(debugVoteAccount, event)
      }
    })
  }

  private formatInfo(): string {
    return this.infos.map(([context, info]) => `DEBUG INFO - ${context}: ${JSON.stringify(info)}`).join('\n')
  }

  private formatEvents(): string {
    return this.events.map(event => `DEBUG EVENT - ${event}`).join('\n')
  }

  log(message: string, ...args: unknown[]): void {
    this.logger.info(message, ...args)
  }

  printDebugContent() {
    this.logger.debug(
      `==============================\n${this.formatInfo()}\n${this.formatEvents()}\n==============================`,
    )
  }
}

export class Logger {
  constructor(private verbosity: LogVerbosity = LogVerbosity.INFO) {}

  setVerbosity(level: LogVerbosity): void {
    this.verbosity = level
  }

  isEnabled(level: LogVerbosity): boolean {
    return level >= this.verbosity
  }

  isDebugEnabled(): boolean {
    return this.isEnabled(LogVerbosity.DEBUG)
  }

  isInfoEnabled(): boolean {
    return this.isEnabled(LogVerbosity.INFO)
  }

  isWarnEnabled(): boolean {
    return this.isEnabled(LogVerbosity.WARN)
  }

  isErrorEnabled(): boolean {
    return this.isEnabled(LogVerbosity.ERROR)
  }

  debug(...args: unknown[]): void {
    if (this.isDebugEnabled()) {
      console.log(...args)
    }
  }

  info(...args: unknown[]): void {
    if (this.isInfoEnabled()) {
      console.log(...args)
    }
  }

  warn(...args: unknown[]): void {
    if (this.isWarnEnabled()) {
      console.warn(...args)
    }
  }

  error(...args: unknown[]): void {
    if (this.isErrorEnabled()) {
      console.error(...args)
    }
  }
}

// Default singleton export (optional)
export const logger = new Logger()
