# ADR-0008: Evidence is bound to a mechanism; only measured mechanisms certify

## Status
Accepted

## Date
2026-11-15

## Context
Two independent Codex reviews (R1, R1.1) rejected the enforcement claims: `capabilities.json` labelled mechanisms ENFORCED on the strength of documentation, unevaluated prose preconditions, or measurements of an earlier form of the mechanism. The Claude R1.2 review found two entries whose evidence predated a mechanism change.

## Decision
1. Each matrix variant carries `evidence: measured | documented | inferred`. Only `measured` (a live contract test on the pinned runtime version, cited by `evidenceRef`) can certify a mandatory restriction.
2. Changing a mechanism (flags, rule form, writable roots…) invalidates its evidence: the variant drops to `inferred` until the live suite re-measures it.
3. Preconditions are machine-checked (`requires`, satisfied by HostFacts), never prose.
4. Variants are conditional (`when`: sandbox, granted capabilities, scope) and declare `holdsFor` — the restriction scopes the mechanism actually enforces. Capability interactions (e.g. a granted shell on Claude) are modelled as variants, not footnotes.
5. A runtime version different from the matrix version fails every mandatory restriction closed.

## Consequences
- Positive: the policy layer can no longer certify what the executor does not enforce.
- Negative: many restrictions currently fail closed until measured; Codex can only act as a read-only reviewer for mandatory path-scoped rules. That is the honest state.
