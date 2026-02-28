export type PatternType = 'error' | 'anti-pattern' | 'style' | 'positive';

export type Severity = 'high' | 'medium' | 'low';

export interface Pattern {
  id: string;
  type: PatternType;
  description: string;
  tags: string[];
  severity: Severity;
  resolution: string;
  frequency: number;
  firstSeen: string;
  lastSeen: string;
  taskId: string | null;
  prNumber: number | null;
}

export interface ReviewOutcome {
  taskId: string;
  prNumber: number;
  outcome: 'passed' | 'failed';
  cycles: number;
  issuesFound: number;
  repo: string | null;
  date: string;
}

export interface MemoryStore {
  patterns: Pattern[];
  reviewOutcomes: ReviewOutcome[];
}

export interface MemoryStats {
  totalReviews: number;
  passed: number;
  failed: number;
  passRate: number;
  avgCycles: number;
}
