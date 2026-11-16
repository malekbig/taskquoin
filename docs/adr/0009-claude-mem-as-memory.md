# ADR-0009: claude-mem as Taskquoin's memory, outside governed runs

## Status
Accepted (owner request, 2026-11-15)

## Context
The owner uses claude-mem (thedotmack/claude-mem 15.18.4, Apache-2.0, upstream HEAD 62ca1eb at assessment) and wants Taskquoin to use it. Inspected on the owner's machine: local worker on 127.0.0.1:37700, HTTP API (`/api/health`, `/api/search`, `/api/memory/save {text,title,project,metadata}`), cloud sync and hosted memory empty, Chroma off. Its normal operation relies on hooks (SessionStart injection), an MCP server and an observer that sends tool activity to a model for compression. **The worker API is unauthenticated on loopback** (it only rejects browser cross-origin requests): any local process can write memories that are later injected into sessions (memory-poisoning vector).

## Decision
- **Interactive sessions**: unchanged; Taskquoin never modifies claude-mem or its configuration.
- **Recall** (before a run, on the host): `MemoryPort.recall` queries the local worker; the bounded excerpt is given to the agent inside `<memory-context trust="untrusted">` — reference data that cannot grant permissions or change instructions; forged closing tags are neutralised.
- **Record** (after a run): a Taskquoin-generated structured summary (status, files, verified test counts, decisions), tagged `metadata.source = "taskquoin"`; no prompts and no raw model output.
- **Never** load claude-mem's hooks, MCP server or observer into governed runs (they inject instructions, add tools and capture transcripts).
- Memory is optional: worker down ⇒ the run proceeds without it.
- ADR-0010 applies: loopback only; if claude-mem is configured for cloud sync or hosted memory, the adapter refuses recall and record.

## Consequences
- Positive: past decisions inform plans; future interactive sessions see what governed runs did.
- Negative: recalled memory may be stale or poisoned — it is framed as untrusted, never as instruction. On Claude without the Bash sandbox, an allowed shell command could reach the worker API (loopback); with the sandbox (ADR-0010) it cannot.
