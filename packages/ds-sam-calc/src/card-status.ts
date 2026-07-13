// Severity enum and CardStatus shapes are pure-data — they live in the calc
// layer so the tip engine and other consumers can build CardStatus values
// without importing UI code. The component layer maps each severity to CSS
// classes; the data layer doesn't know or care about presentation.

export type CardStatusSeverity = 'critical' | 'warning' | 'good' | 'neutral'

// Pure-data description of an action affordance: what the pill says and its
// severity. The click mechanism (onClick) is UI — the dashboard injects it
// when rendering, so the calc layer decides the action without owning it.
export type CardStatusAction = {
  label: string
  // Defaults to the banner's own severity (e.g. a critical status with a
  // critical "Bond tab →" pill). Override to 'warning' for sim-jump pills so
  // the simulation affordance reads consistently across severities.
  severity?: CardStatusSeverity
}

export type CardStatus = {
  label: string
  severity: CardStatusSeverity
  action?: CardStatusAction
}
