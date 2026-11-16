# ADR-0012: Remote connectors (Jira, GitHub, GitLab…) only by explicit per-connector exception

## Status
Accepted (owner, 2026-11-15: option B)

## Context
ADR-0010 allows egress only to the AI providers. Jira, GitHub and GitLab are remote services by nature; the original request asked for Jira and MCP connectors.

## Decision
- Every remote connector is **disabled by default**. Enabling one is an explicit entry in `taskquoin.yaml` (`connectors.<id>`), naming: the service host, ONE scope (Jira project key / repository), read operations allowed, and write operations allowed.
- **Reads**: only within the declared scope; responses are untrusted data (T3).
- **Writes** (comment, transition, PR, MR…): never by an agent; always an action proposal executed by the Action Broker after a human approval bound to the exact action (ADR-0004). Nothing is sent besides the approved payload.
- Credentials: least-privilege tokens scoped to that project/repo, referenced by name (env var / OS keychain), never in the repository and never in an agent's environment.
- `taskquoin doctor` lists every enabled exception and the hosts it allows; nothing else may be contacted.
- Implementation: R6 (GitHub read + one brokered write), Jira in Phase B.

## Consequences
The "local except the AIs" rule keeps a single, visible, owner-approved hole per connector, bounded to one scope.
