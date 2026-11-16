/**
 * Single source of protected paths (review M4, ADR-0003). Consumed by the rules engine (hooks, CI gate) and by the
 * Claude permission compiler, so editor, hook and CI give one verdict.
 */
/** Project-relative: never written by an agent. */
export const PROTECTED_WRITE_GLOBS: readonly string[] = [
  '.claude/**', '.codex/**', '.agents/**', '.taskquoin/**', 'taskquoin.yaml', '.git/**',
  'CLAUDE.md', 'AGENTS.md', '**/CLAUDE.md', '**/AGENTS.md', '.mcp.json',
  '.github/workflows/**', '.gitlab-ci.yml', '.husky/**', '.pre-commit-config.yaml', 'lefthook.yml',
  // git behaviour switches (filters, LFS, submodules) — Codex R4 N5
  '.gitattributes', '**/.gitattributes', '.gitmodules',
];
/** Project-relative: never read by an agent. */
export const SECRET_READ_GLOBS: readonly string[] = ['.env', '.env.*', '**/.env', '**/.env.*', '**/*.pem', '**/*.key'];
/** HOME-relative: never read by an agent. */
export const HOME_SECRET_GLOBS: readonly string[] = [
  '.ssh/**', '.aws/**', '.azure/**', '.kube/**', '.docker/config.json', '.config/gh/**', '.npmrc',
  '.claude/.credentials.json', '.claude.json', '.codex/auth.json',
];

/**
 * Paths treated as tests for Taskquoin's RED proof (base + only these changes must FAIL). Conventions where the path
 * itself says "test" (Codex RED #1: no `*Test.java` / `spec/` — they also name production code). A change touching
 * only such paths skips the RED proof, which is stated to the reviewer and in the commit message.
 */
export const TEST_PATH_GLOBS: readonly string[] = [
  '**/*.test.*', '**/*.spec.*', '**/*_test.go', '**/*_test.py', '**/test_*.py',
  '**/test/**', '**/tests/**', '**/__tests__/**',
];
