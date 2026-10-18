import type { ImportEvidence } from "../types.js";

export function selectPrimaryEvidence(
  evidence: ImportEvidence[],
): ImportEvidence | undefined {
  return (
    evidence.find(({ statement }) => statement.includes("()")) ?? evidence[0]
  );
}

export function formatEvidenceLocation(
  evidence: ImportEvidence | undefined,
): string | undefined {
  if (!evidence) {
    return undefined;
  }
  const location = evidence.line
    ? `${evidence.filePath}:${evidence.line}`
    : evidence.filePath;
  return evidence.statement.includes("()")
    ? `${location} (${evidence.statement})`
    : location;
}
