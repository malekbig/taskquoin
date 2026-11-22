# ADR-0019: A native ANSI terminal UI, no library

## Status
Accepted — design approved by the maintainer on 2026-11-22.

## Context
Console V2 and the dashboard need a richer terminal interface: panels, colour tokens, keyboard navigation, a
no-colour and a plain mode. The design of 2026-11-22 compared four options on dependencies, maintenance, Node 22 / ESM
/ type-stripping fit, neutralisation of untrusted content, testability, accessibility and security surface:

| Criterion | Native ANSI (Node built-ins) | Ink 5 (React) | blessed / neo-blessed | terminal-kit |
|---|---|---|---|---|
| Dependencies added | 0 | react, react-reconciler, yoga (WASM), ~30 transitive | one large package | ~10 |
| Maintenance | ours | active | blessed frozen since 2015, forks barely followed | low activity |
| Node 22 / ESM / type stripping | native | ESM, but JSX needs a compile step (no type stripping for `.tsx`) | CJS, terminfo | CJS |
| Neutralising content | one point, ours | `<Text>` lets sequences through | `{bold}` tags interpreted inside content | same (`^R` markers) |
| Tests | pure `render(model, caps) → string[]` | ink-testing-library | hard (global screen) | hard |
| Accessibility, NO_COLOR, plain mode | to build (planned, tested) | partial | no | partial |
| Security surface | minimal | medium (third-party code in every frame) | high (tag parsing) | medium |

Taskquoin is a governed tool published with a signed provenance: every added dependency widens what a user must trust,
and every screen shows text that an agent, a process or a file name controls.

## Decision
1. **Native ANSI, no new dependency.** A small module `apps/cli/src/tui/` holds the primitives: capability detection
   (`caps.ts`), design tokens, glyphs and painting (`tokens.ts`), then screen, keyboard and components in later steps.
2. **Pure renderers.** Each screen is `render(model, caps) → string[]`: no I/O, no clock, no environment read. Capabilities
   are detected once (interactive, colour depth, charset, theme, motion, plain mode, size) and passed down. Tests are
   deterministic and the Gherkin scenarios stay unchanged.
3. **One neutraliser.** Untrusted text (agent and process output, file names, artifacts, network, config values) goes
   through `neutralize()` once, when the model is built; renderers accept only the neutralised type.
4. **Colour through the depth.** Tokens map to truecolor, 256 and 16 colours, and to nothing under `NO_COLOR`; Windows
   Terminal (`WT_SESSION`) is raised from 8 to 24 because it supports truecolor yet reports 8. The terminal is never
   queried (no OSC 11), so nothing races with what the human types.
5. **`readline` stays** for the console; the dashboard uses raw mode with the terminal always restored.

## Consequences
- Zero added dependencies, full control of neutralisation, deterministic tests, a minimal security surface.
- We write and maintain about 600 lines of primitives (screen, keyboard, components) ourselves, including width,
  truncation and resize handling that a library would provide.
- Complex forms are out of scope; the approval stays a typed hash, never a key press.
- Known limit: ambiguous-width glyphs are measured as one cell.

## Alternatives rejected
- **Ink**: pulls React, a reconciler and a WASM layout engine (about 30 transitive packages) into a signed tool, needs a
  JSX compile step that Node's type stripping does not provide, and its text component passes escape sequences through.
- **blessed / neo-blessed**: unmaintained since 2015, CommonJS, interprets `{bold}`-style tags inside content, and its
  global screen makes tests hard.
- **terminal-kit**: low activity, CommonJS, interprets inline markers in content, hard to test.
