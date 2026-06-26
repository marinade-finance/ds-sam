// Tone enum and CardStatus shapes are pure-data — they live in the calc layer
// so the tip engine and other consumers can build CardStatus values without
// importing UI code. The component layer maps the enum to CSS classes; the
// data layer doesn't know or care.

export type CardStatusTone = 'red' | 'yellow' | 'green' | 'grey'

// Pure-data description of an action affordance: what the pill says and what
// colour it is. The click mechanism (onClick) is UI — the dashboard intersects
// it in when rendering, so the calc layer decides the action without owning it.
export type CardStatusAction = {
  label: string
  // Pill colour. Defaults to the banner's own tone (e.g. red status with a
  // red "Bond tab →" pill). Override to 'yellow' for sim-jump pills so the
  // simulation affordance reads consistently across tones.
  tone?: CardStatusTone
}

export type CardStatus = {
  label: string
  tone: CardStatusTone
  action?: CardStatusAction
}
