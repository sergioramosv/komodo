export interface TaskRecord {
  taskId: string;
  plannerModel: string;
  coderModel: string;
  reviewerModel: string;
  reviewScore: number | null;
  reviewCycles: number;
  durationSeconds: number;
  cost: number;
  completedAt: string;
}

export interface LeaderboardRow {
  model: string;
  role: string;
  /** null when no review scores exist for this model+role combo */
  avgScore: number | null;
  avgCycles: number;
  avgDurationMinutes: number;
  avgCost: number;
  taskCount: number;
}

function avg(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface OptimalModel {
  role: string;
  model: string;
  avgScore: number;
  taskCount: number;
  label: string;
}

export interface ModelRecommendation {
  role: string;
  currentDefault: string;
  currentAvgScore: number;
  currentAvgCost: number;
  recommended: string;
  recommendedAvgScore: number;
  recommendedAvgCost: number;
  savingsPercent: number;
  message: string;
}

const MIN_TASKS_FOR_HIGHLIGHT = 3;
const RECOMMENDATION_SCORE_THRESHOLD = 8;

const ROLE_LABELS: Record<string, string> = {
  planner: 'planner tasks',
  coder: 'coder tasks',
  reviewer: 'reviewer tasks',
};

/**
 * Finds the optimal (highest avg score) model for each role.
 * Requires at least MIN_TASKS_FOR_HIGHLIGHT scored tasks to qualify.
 */
export function computeOptimalModels(leaderboard: LeaderboardRow[]): OptimalModel[] {
  const bestByRole: Record<string, LeaderboardRow> = {};

  for (const row of leaderboard) {
    if (row.avgScore === null || row.taskCount < MIN_TASKS_FOR_HIGHLIGHT) continue;

    const current = bestByRole[row.role];
    if (!current || (row.avgScore > (current.avgScore ?? -1))) {
      bestByRole[row.role] = row;
    }
  }

  return Object.entries(bestByRole).map(([role, row]) => ({
    role,
    model: row.model,
    avgScore: row.avgScore!,
    taskCount: row.taskCount,
    label: `Best for ${ROLE_LABELS[role] || role}: ${row.model} (${row.avgScore!.toFixed(1)} avg score)`,
  }));
}

/**
 * Finds cheaper models that consistently score above the threshold.
 * Compares against the most expensive model per role that also scores well.
 */
export function computeRecommendations(leaderboard: LeaderboardRow[]): ModelRecommendation[] {
  const recommendations: ModelRecommendation[] = [];
  const byRole: Record<string, LeaderboardRow[]> = {};

  for (const row of leaderboard) {
    if (row.avgScore === null || row.taskCount < MIN_TASKS_FOR_HIGHLIGHT) continue;
    if (!byRole[row.role]) byRole[row.role] = [];
    byRole[row.role].push(row);
  }

  for (const [role, rows] of Object.entries(byRole)) {
    if (rows.length < 2) continue;

    // Sort by cost descending to find the most expensive model
    const sorted = [...rows].sort((a, b) => b.avgCost - a.avgCost);
    const mostExpensive = sorted[0];

    // Find cheaper models with score > threshold
    for (const candidate of sorted.slice(1)) {
      if (
        candidate.avgScore! >= RECOMMENDATION_SCORE_THRESHOLD &&
        candidate.avgCost < mostExpensive.avgCost
      ) {
        const savingsPercent = mostExpensive.avgCost > 0
          ? round2(((mostExpensive.avgCost - candidate.avgCost) / mostExpensive.avgCost) * 100)
          : 0;

        recommendations.push({
          role,
          currentDefault: mostExpensive.model,
          currentAvgScore: mostExpensive.avgScore!,
          currentAvgCost: mostExpensive.avgCost,
          recommended: candidate.model,
          recommendedAvgScore: candidate.avgScore!,
          recommendedAvgCost: candidate.avgCost,
          savingsPercent,
          message: `Consider ${candidate.model} for ${role}: scores ${candidate.avgScore!.toFixed(1)} avg with ${savingsPercent}% lower cost than ${mostExpensive.model}`,
        });
        break; // One recommendation per role
      }
    }
  }

  return recommendations;
}

export function computeLeaderboard(
  tasks: TaskRecord[],
  allowedTaskIds: Set<string> | null,
): LeaderboardRow[] {
  const groups: Record<string, {
    model: string;
    role: string;
    scores: number[];
    cycles: number[];
    durations: number[];
    costs: number[];
  }> = {};

  for (const task of tasks) {
    if (allowedTaskIds !== null && !allowedTaskIds.has(task.taskId)) continue;

    const roleModels: { role: string; model: string }[] = [
      { role: 'planner', model: task.plannerModel },
      { role: 'coder', model: task.coderModel },
      { role: 'reviewer', model: task.reviewerModel },
    ];

    for (const { role, model } of roleModels) {
      if (!model) continue;
      const key = `${model}::${role}`;
      if (!groups[key]) {
        groups[key] = { model, role, scores: [], cycles: [], durations: [], costs: [] };
      }
      if (task.reviewScore != null) groups[key].scores.push(task.reviewScore);
      groups[key].cycles.push(task.reviewCycles);
      groups[key].durations.push(task.durationSeconds);
      groups[key].costs.push(task.cost);
    }
  }

  return Object.values(groups)
    .map(({ model, role, scores, cycles, durations, costs }) => ({
      model,
      role,
      avgScore: scores.length > 0 ? round2(avg(scores)) : null,
      avgCycles: round2(avg(cycles)),
      avgDurationMinutes: round2(avg(durations) / 60),
      avgCost: round2(avg(costs)),
      taskCount: cycles.length,
    }))
    .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
}
