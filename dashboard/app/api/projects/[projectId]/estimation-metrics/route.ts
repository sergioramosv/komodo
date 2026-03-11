import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/firebase';

const TOKEN_TIERS: Record<string, number> = {
  trivial: 8000,
  standard: 25000,
  complex: 60000,
};

interface TaskMetric {
  taskId: string;
  projectId: string;
  estimatedDevPoints: number;
  estimatedTokens?: number;
  totalDurationSeconds: number;
  reviewCycles: number;
  approved: boolean;
  merged: boolean;
  filesChanged: string[];
  filesCount: number;
  model: string;
  completedAt: string;
}

interface RangeStats {
  taskCount: number;
  avgDuration: number;
  avgReviewCycles: number;
  avgFilesChanged: number;
  avgDevPoints: number;
}

function calculateRatios(metrics: TaskMetric[]) {
  const ranges: Record<string, { min: number; max: number; tasks: TaskMetric[] }> = {
    trivial: { min: 1, max: 2, tasks: [] },
    standard: { min: 3, max: 5, tasks: [] },
    complex: { min: 8, max: 13, tasks: [] },
  };

  for (const m of metrics) {
    const pts = m.estimatedDevPoints || 0;
    if (pts >= 1 && pts <= 2) ranges.trivial.tasks.push(m);
    else if (pts >= 3 && pts <= 5) ranges.standard.tasks.push(m);
    else if (pts >= 8) ranges.complex.tasks.push(m);
  }

  const result: Record<string, RangeStats | null> = {};

  for (const [name, range] of Object.entries(ranges)) {
    if (range.tasks.length === 0) {
      result[name] = null;
      continue;
    }

    const tasks = range.tasks;
    const count = tasks.length;

    result[name] = {
      taskCount: count,
      avgDuration: tasks.reduce((s, t) => s + (t.totalDurationSeconds || 0), 0) / count,
      avgReviewCycles: tasks.reduce((s, t) => s + (t.reviewCycles || 0), 0) / count,
      avgFilesChanged: tasks.reduce((s, t) => s + (t.filesCount || 0), 0) / count,
      avgDevPoints: tasks.reduce((s, t) => s + (t.estimatedDevPoints || 0), 0) / count,
    };
  }

  return result;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const snapshot = await getDb().ref(`metrics/${projectId}/tasks`).once('value');
    const data = snapshot.val();

    if (!data) {
      return NextResponse.json({
        metrics: [],
        ratios: { trivial: null, standard: null, complex: null },
        warnings: [],
        totalTasks: 0,
      });
    }

    const metrics: TaskMetric[] = Object.values(data);
    const ratios = calculateRatios(metrics);

    // Detect underestimated categories (avg review cycles >= 4)
    const CYCLE_THRESHOLD = 4;
    const warnings: Array<{ range: string; avgReviewCycles: number; message: string }> = [];

    for (const [rangeName, stats] of Object.entries(ratios)) {
      if (!stats || stats.taskCount < 3) continue;
      if (stats.avgReviewCycles >= CYCLE_THRESHOLD) {
        warnings.push({
          range: rangeName,
          avgReviewCycles: Math.round(stats.avgReviewCycles * 10) / 10,
          message: `"${rangeName}" tasks consistently need ${stats.avgReviewCycles.toFixed(1)} review cycles`,
        });
      }
    }

    // Build chart data: each task as a point (estimated vs actual)
    const chartData = metrics.map((m) => ({
      taskId: m.taskId,
      estimatedDevPoints: m.estimatedDevPoints,
      actualDurationMinutes: Math.round((m.totalDurationSeconds || 0) / 60),
      reviewCycles: m.reviewCycles,
      filesCount: m.filesCount,
      model: m.model,
      completedAt: m.completedAt,
    }));

    // Build tokenRatios: per-tier token stats with avg efficiency (bizPoints/estimatedTokens)
    const tokenRatios: Record<string, {
      estimatedTokens: number;
      avgEstimatedTokens: number | null;
      avgEfficiency: number | null;
      taskCount: number;
    }> = {};

    for (const [rangeName, stats] of Object.entries(ratios)) {
      const tierTasks = metrics.filter((m) => {
        const pts = m.estimatedDevPoints || 0;
        if (rangeName === 'trivial') return pts >= 1 && pts <= 2;
        if (rangeName === 'standard') return pts >= 3 && pts <= 5;
        if (rangeName === 'complex') return pts >= 8;
        return false;
      });

      const tasksWithTokens = tierTasks.filter((m) => m.estimatedTokens != null && m.estimatedTokens > 0);
      const avgEstimatedTokens =
        tasksWithTokens.length > 0
          ? tasksWithTokens.reduce((s, t) => s + (t.estimatedTokens ?? 0), 0) / tasksWithTokens.length
          : null;

      tokenRatios[rangeName] = {
        estimatedTokens: TOKEN_TIERS[rangeName] ?? 0,
        avgEstimatedTokens: avgEstimatedTokens !== null ? Math.round(avgEstimatedTokens) : null,
        avgEfficiency: stats ? Math.round(((stats.avgDevPoints ?? 0) / (TOKEN_TIERS[rangeName] ?? 1)) * 1e6) / 1e6 : null,
        taskCount: tierTasks.length,
      };
    }

    return NextResponse.json({
      metrics: chartData,
      ratios,
      warnings,
      totalTasks: metrics.length,
      tokenRatios,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
