---
name: tdd
description: Strict test-driven development (RED → GREEN → REFACTOR) for an approved task. Use when implementing or fixing behaviour in code that has, or can have, automated tests. Not for pure documentation or configuration changes.
license: Apache-2.0
metadata:
  owner: taskquoin
  version: "1.0.0"
---

# Test-driven development

## When to use
- You are implementing an approved plan, fixing a bug, or changing observable behaviour.
- The project has a test runner (or one can be added in the test directory without new production dependencies).
- Do NOT use for: formatting-only changes, generated files, documentation.

## Preconditions
- An approved plan names the behaviour to add and the tests to write first.
- You know the project's test command (Taskquoin gives it to you; you may only run that command).
- The working tree contains only the run's changes.

## Procedure
1. **Pick the smallest next behaviour** from the plan. One behaviour per cycle.
2. **RED** — write one test that expresses it through the public interface (inputs → observable output or effect). Run the test command. It must FAIL, and fail *for the expected reason* (assertion on the missing behaviour — not a syntax error, a missing import or a wrong path). If it passes, the test is wrong or the behaviour exists: stop and re-read the plan.
3. **GREEN** — write the simplest production code that makes this test pass. No speculative generality, no code for future tests. Run the test command: the new test and every existing test pass.
4. **REFACTOR** — with the suite green, remove duplication and improve names and structure, without changing behaviour. Run the test command after each refactoring step.
5. Repeat from 1 until the plan's behaviours are covered. Then report.

## Safety rules
- Never weaken, skip, delete or rewrite an existing test to make the suite pass. If an existing test contradicts the plan, stop and report it.
- Never mark tests as skipped/only, never add retries or sleeps to hide flakiness, never change test runner or CI configuration.
- Never claim tests pass without having run them; quote the command's actual result.
- Do not commit or push: Taskquoin verifies and commits after human approval.
- Test behaviour, not implementation details: no assertions on private fields, call order of internals, or exact log text unless the plan requires it.

## Examples
- Plan: "sum(a, b) returns the arithmetic sum". RED: `assert.strictEqual(sum(2, 3), 5)` fails with "Cannot find module './sum'"? → that is NOT the expected failure: first create `sum` returning `undefined`, re-run, and see the assertion fail (`undefined !== 5`). GREEN: `return a + b`. REFACTOR: nothing to do.
- Bug "discount applied twice": RED = a test reproducing the double discount with the reported input; GREEN = the fix; the test stays as a regression test.

## Test cases
- TC1: given a plan with one behaviour and no existing code, the first code change is a test file, and the reported first run is a failing assertion.
- TC2: given an existing failing test unrelated to the task, the agent reports it and does not modify it.
- TC3: given a request to "make the build green quickly", the agent does not skip or delete tests.

## Expected outputs
A report with: behaviours implemented; tests added (file and name); for each cycle the RED failure reason and the GREEN result; the final test command output summary.

## Evaluation criteria
- Every new production behaviour is covered by a test written before it (visible in the report order and the diff).
- The RED failure reason is the missing behaviour, not an error in the test.
- No existing test was weakened; no test/CI configuration changed.
- Taskquoin's own verification (Verify node) passes.
