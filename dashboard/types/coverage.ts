export interface CoverageEntry {
  coverage: number;
  delta: number | null;
  commitSha: string;
  prNumber: string;
  timestamp: string;
}
