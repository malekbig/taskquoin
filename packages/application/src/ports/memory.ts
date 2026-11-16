/**
 * MemoryPort (ADR-0009). Memory is OPTIONAL: an unavailable memory never blocks or fails a run.
 * Recall happens on the host, before a run; the agent receives the excerpt as untrusted reference data.
 * Record stores a structured, Taskquoin-generated run summary — never prompts or raw model output.
 */
export interface MemoryRecall { source: string; project: string; query: string; text: string; truncated: boolean }

export interface RunSummary {
  runId: string; workflow: string; status: string; project: string;
  filesChanged: string[]; tests?: { passed: number; failed: number };
  /** Short, Taskquoin-authored decision lines (e.g. "plan approved by owner"). */
  decisions: string[];
}

export interface MemoryPort {
  available(): Promise<boolean>;
  recall(query: string, project: string): Promise<MemoryRecall | undefined>;
  record(summary: RunSummary): Promise<{ recorded: boolean; reason?: string }>;
}
