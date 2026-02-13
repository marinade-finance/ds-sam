import { AuctionConstraintType } from './types'

import type { AuctionConstraints } from './constraints'
import type { AuctionConstraint, AuctionConstraintsConfig, AuctionValidator, ConstraintDiagnostic } from './types'

export function computeConstraintDiagnostics(
  validator: AuctionValidator,
  constraints: AuctionConstraints,
): ConstraintDiagnostic[] {
  const validatorConstraints = constraints.getValidatorConstraints(validator.voteAccount)
  if (!validatorConstraints) {
    return []
  }

  const config = constraints.getConfig()
  const bindingType = validator.lastCapConstraint?.constraintType ?? null
  const bindingName = validator.lastCapConstraint?.constraintName ?? null

  const diagnostics: ConstraintDiagnostic[] = validatorConstraints.map(constraint => {
    const isBinding = constraint.constraintType === bindingType && constraint.constraintName === bindingName

    const marinadeCapSol = constraint.marinadeStakeSol + constraint.marinadeLeftToCapSol
    const totalCapSol = constraint.totalStakeSol + constraint.totalLeftToCapSol

    const headroomSol = Math.max(0, Math.min(constraint.totalLeftToCapSol, constraint.marinadeLeftToCapSol))

    return {
      constraintType: constraint.constraintType,
      constraintName: constraint.constraintName,
      isBinding,
      marinadeCapSol,
      marinadeUsedSol: constraint.marinadeStakeSol,
      marinadeRemainingCapSol: constraint.marinadeLeftToCapSol,
      totalCapSol,
      totalUsedSol: constraint.totalStakeSol,
      totalRemainingCapSol: constraint.totalLeftToCapSol,
      validatorsInGroup: constraint.validators.length,
      headroomSol,
      advice: generateAdvice(constraint, config),
    }
  })

  diagnostics.sort((a, b) => a.headroomSol - b.headroomSol)
  return diagnostics
}

function generateAdvice(constraint: AuctionConstraint, _config: AuctionConstraintsConfig): string | null {
  const { constraintType, constraintName } = constraint
  const marinadeCapSol = constraint.marinadeStakeSol + constraint.marinadeLeftToCapSol
  const totalCapSol = constraint.totalStakeSol + constraint.totalLeftToCapSol
  const n = constraint.validators.length

  switch (constraintType) {
    case AuctionConstraintType.COUNTRY: {
      const usedPct = totalCapSol > 0 ? Math.round((constraint.totalStakeSol / totalCapSol) * 100) : 0
      return `Country ${constraintName}: ${usedPct}% of ${fmt(totalCapSol)} SOL network cap used by ${n} validators`
    }
    case AuctionConstraintType.ASO: {
      const usedPct = totalCapSol > 0 ? Math.round((constraint.totalStakeSol / totalCapSol) * 100) : 0
      return `ASO ${constraintName}: ${usedPct}% of ${fmt(totalCapSol)} SOL network cap used by ${n} validators`
    }
    case AuctionConstraintType.VALIDATOR: {
      return `Per-validator cap: ${fmt(marinadeCapSol)} SOL`
    }
    case AuctionConstraintType.BOND: {
      return `Bond supports up to ${fmt(marinadeCapSol)} SOL Marinade stake`
    }
    case AuctionConstraintType.WANT: {
      return `Max stake wanted set to ${fmt(marinadeCapSol)} SOL`
    }
    case AuctionConstraintType.RISK: {
      return `Unprotected stake limit: ${fmt(marinadeCapSol)} SOL`
    }
    default:
      return null
  }
}

function fmt(sol: number): string {
  if (!isFinite(sol)) return '∞'
  return Math.round(sol).toLocaleString('en-US')
}
