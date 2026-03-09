import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/firebase';
import { computeLeaderboard } from '@/lib/leaderboard';
import type { TaskRecord } from '@/lib/leaderboard';

interface PersistedEvent {
  type: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  taskId: string | null;
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

function isValidDate(d: Date): boolean {
  return !isNaN(d.getTime());
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

    // Filter by period using completedAt — validate date before comparing
    const periodStart = getPeriodStart(period);
    if (periodStart) {
      tasks = tasks.filter(t => {
        const d = new Date(t.completedAt);
        return isValidDate(d) && d >= periodStart;
      });
    }

    // Filter by complexity: single read of all project events, then filter in-memory
    let allowedTaskIds: Set<string> | null = null;
    if (complexity) {
      const complexityRanges: Record<string, [number, number]> = {
        trivial: [1, 2],
        standard: [3, 5],
        complex: [8, 100],
      };
      const range = complexityRanges[complexity];
      if (range) {
        // One single read instead of one query per day (~2252 queries for period=all)
        const eventsSnap = await db.ref(`events/${projectId}`).once('value');
        const eventsData = eventsSnap.val();
        const taskIdsWithComplexity = new Set<string>();

        if (eventsData) {
          for (const dayEvents of Object.values(eventsData) as Record<string, PersistedEvent>[]) {
            for (const evt of Object.values(dayEvents)) {
              if (evt.type !== 'task:completed') continue;
              const pts = (evt.metadata?.devPoints as number) || 0;
              if (pts >= range[0] && pts <= range[1] && evt.taskId) {
                taskIdsWithComplexity.add(evt.taskId);
              }
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
