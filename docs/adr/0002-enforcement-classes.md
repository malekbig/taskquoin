# ADR-0002: Every compiled capability carries an enforcement class

## Status
Accepted

## Date
2026-11-15

## Context
v0.1 treated `fs.write`, `net.allow` as portable. Codex review (P0) showed compilation could silently grant more authority than declared. ai-craftsman-superpowers measures per-host capabilities in `host-capabilities.json` instead of asserting them.

## Decision
Each runtime adapter ships a measured, versioned `capabilities.json`. Compilation resolves every policy restriction to `ENFORCED | BROKERED | ADVISORY | UNSUPPORTED`. A restriction marked `mandatory` that resolves to ADVISORY or UNSUPPORTED fails compilation with remediation text. `doctor` prints the effective matrix.

## Consequences
- Positive: honest security claims; users see exactly what is enforced where.
- Negative: more compile failures on weaker hosts; matrix must be re-measured per supported runtime version.
