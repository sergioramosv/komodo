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
