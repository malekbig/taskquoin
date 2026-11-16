# ADR-0004: Agents propose external actions; a broker executes approved ones

## Status
Accepted

## Date
2026-11-15

## Context
If an agent holds a GitHub/Jira write-capable MCP server, any workflow approval gate can be bypassed by calling the tool directly (Codex review P0). Approval must bind to the exact action, not to a position in a graph.

## Decision
Only read-scoped connectors are compiled into agent configurations. Writes are JSON *action proposals* written as artifacts. The Action Broker validates target and arguments against configured scope, creates an approval binding `{type, target, normalizedArgsHash, baseRevision, policyDigest, expiresAt, nonce}`, waits for a human approval, executes with an idempotency key and journals `intent → executed → confirmed`. Unknown outcome ⇒ `NEEDS_RECONCILIATION`, never automatic retry. Write credentials never appear in an agent's environment.

## Consequences
- Positive: no second path to side effects; approvals are specific, single-use, expiring.
- Negative: one more hop for every external write; brokers must be written per connector.
