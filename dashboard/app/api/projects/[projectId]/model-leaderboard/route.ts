import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/firebase';

interface TaskRecord {
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

interface PersistedEvent {
  type: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  taskId: string | null;
}

interface LeaderboardRow {
  model: string;
  role: string;
  avgScore: number;
  avgCycles: number;
  avgDurationMinutes: number;
  avgCost: number;
  taskCount: number;
}

function getPeriodStart(period: string): Date | null {
  if (period === 'week') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (period === 'month') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }
  return null;
}

function computeLeaderboard(
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

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const round2 = (v: number) => Math.round(v * 100) / 100;

  return Object.values(groups)
    .map(({ model, role, scores, cycles, durations, costs }) => ({
      model,
      role,
      avgScore: round2(avg(scores)),
      avgCycles: round2(avg(cycles)),
      avgDurationMinutes: round2(avg(durations) / 60),
      avgCost: round2(avg(costs)),
      taskCount: cycles.length,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const url = new URL(req.url);
    const complexity = url.searchParams.get('complexity') || '';
    const period = url.searchParams.get('period') || 'all';

    const db = getDb();

    // Load all per-task model performance records
    const tasksSnap = await db
      .ref(`metrics/${projectId}/model-performance/tasks`)
      .once('value');
    const tasksData = tasksSnap.val();
    if (!tasksData) {
      return NextResponse.json({ leaderboard: [] });
    }

    let tasks: TaskRecord[] = Object.values(tasksData) as TaskRecord[];

    // Filter by period using completedAt
    const periodStart = getPeriodStart(period);
    if (periodStart) {
      tasks = tasks.filter(t => new Date(t.completedAt) >= periodStart);
    }

    // Filter by complexity: requires joining with events data
    let allowedTaskIds: Set<string> | null = null;
    if (complexity) {
      const complexityRanges: Record<string, [number, number]> = {
        trivial: [1, 2],
        standard: [3, 5],
        complex: [8, 100],
      };
      const range = complexityRanges[complexity];
      if (range) {
        // Determine date range to scan events
        const now = new Date();
        const scanStart = periodStart || new Date('2020-01-01');
        const taskIdsWithComplexity = new Set<string>();

        for (let d = new Date(scanStart); d <= now; d.setDate(d.getDate() + 1)) {
          const date = d.toISOString().slice(0, 10);
          const evtSnap = await db.ref(`events/${projectId}/${date}`).once('value');
          const evtData = evtSnap.val();
          if (!evtData) continue;
          for (const evt of Object.values(evtData) as PersistedEvent[]) {
            if (evt.type !== 'task:completed') continue;
            const pts = (evt.metadata?.devPoints as number) || 0;
            if (pts >= range[0] && pts <= range[1] && evt.taskId) {
              taskIdsWithComplexity.add(evt.taskId);
            }
          }
        }
        allowedTaskIds = taskIdsWithComplexity;
      }
    }

    const leaderboard = computeLeaderboard(tasks, allowedTaskIds);
    return NextResponse.json({ leaderboard });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
