// Exhaustiveness helper. Use as the `default` case of a switch over a
// discriminated union — the type system rejects the call if any case is
// missing, and at runtime it throws so a future union member with no handler
// fails loud instead of silently picking a fallback.
export function assertNever(x: never): never {
  throw new Error(`unreachable: ${JSON.stringify(x)}`)
}
