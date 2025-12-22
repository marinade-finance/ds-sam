export class Debug {
  private infos: [string, string][] = []
  private events: string[] = []

  constructor(private readonly voteAccounts: Set<string>) {}

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

  formatInfo(): string {
    return this.infos.map(([context, info]) => `DEBUG INFO - ${context}: ${JSON.stringify(info)}`).join('\n')
  }

  formatEvents(): string {
    return this.events.map(event => `DEBUG EVENT - ${event}`).join('\n')
  }
}
