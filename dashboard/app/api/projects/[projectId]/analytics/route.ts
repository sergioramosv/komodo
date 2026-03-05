import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/firebase';

interface PersistedEvent {
  type: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  agentName: string | null;
  taskId: string | null;
}

interface SprintVelocity {
  sprint: string;
  tasksCompleted: number;
  devPoints: number;
}

interface SprintCost {
  sprint: string;
  totalCost: number;
  taskCount: number;
  avgCostPerTask: number;
}

interface ReviewPassRate {
  sprint: string;
  total: number;
  passedFirst: number;
  rate: number;
}

interface DurationByComplexity {
  complexity: string;
  avgMinutes: number;
  taskCount: number;
}

interface ModelUsage {
  model: string;
  count: number;
  avgScore: number;
}

function groupBySprint(events: PersistedEvent[], type: string): Record<string, PersistedEvent[]> {
  const groups: Record<string, PersistedEvent[]> = {};
  for (const e of events) {
    if (e.type !== type) continue;
    const sprint = (e.metadata?.sprint as string) || 'unknown';
    if (!groups[sprint]) groups[sprint] = [];
    groups[sprint].push(e);
  }
  return groups;
}

function buildVelocity(events: PersistedEvent[]): SprintVelocity[] {
  const groups = groupBySprint(events, 'task:completed');
  return Object.entries(groups)
    .map(([sprint, evts]) => ({
      sprint,
      tasksCompleted: evts.length,
      devPoints: evts.reduce((s, e) => s + ((e.metadata?.devPoints as number) || 0), 0),
    }))
    .sort((a, b) => a.sprint.localeCompare(b.sprint));
}

function buildCostPerSprint(events: PersistedEvent[]): SprintCost[] {
  const groups = groupBySprint(events, 'task:completed');
  return Object.entries(groups)
    .map(([sprint, evts]) => {
      const totalCost = evts.reduce((s, e) => s + ((e.metadata?.totalCost as number) || 0), 0);
      return {
        sprint,
        totalCost: Math.round(totalCost * 100) / 100,
        taskCount: evts.length,
        avgCostPerTask: evts.length > 0 ? Math.round((totalCost / evts.length) * 100) / 100 : 0,
      };
    })
    .sort((a, b) => a.sprint.localeCompare(b.sprint));
}

function buildReviewPassRate(events: PersistedEvent[]): ReviewPassRate[] {
  const completed = events.filter(e => e.type === 'task:completed');
  const groups: Record<string, PersistedEvent[]> = {};
  for (const e of completed) {
    const sprint = (e.metadata?.sprint as string) || 'unknown';
    if (!groups[sprint]) groups[sprint] = [];
    groups[sprint].push(e);
  }
  return Object.entries(groups)
    .map(([sprint, evts]) => {
      const total = evts.length;
      const passedFirst = evts.filter(e => ((e.metadata?.reviewCycles as number) || 1) <= 1).length;
      return {
        sprint,
        total,
        passedFirst,
        rate: total > 0 ? Math.round((passedFirst / total) * 100) : 0,
      };
    })
    .sort((a, b) => a.sprint.localeCompare(b.sprint));
}

function buildDurationByComplexity(events: PersistedEvent[]): DurationByComplexity[] {
  const completed = events.filter(e => e.type === 'task:completed');
  const groups: Record<string, number[]> = {};

  for (const e of completed) {
    const pts = (e.metadata?.devPoints as number) || 0;
    let complexity = 'unknown';
    if (pts >= 1 && pts <= 2) complexity = 'trivial';
    else if (pts >= 3 && pts <= 5) complexity = 'standard';
    else if (pts >= 8) complexity = 'complex';

    if (!groups[complexity]) groups[complexity] = [];
    const duration = (e.metadata?.totalDurationSeconds as number) || 0;
    groups[complexity].push(duration / 60);
  }

  const order = ['trivial', 'standard', 'complex', 'unknown'];
  return order
    .filter(c => groups[c] && groups[c].length > 0)
    .map(complexity => ({
      complexity,
      avgMinutes: Math.round(groups[complexity].reduce((s, v) => s + v, 0) / groups[complexity].length),
      taskCount: groups[complexity].length,
    }));
}

function buildModelUsage(events: PersistedEvent[]): ModelUsage[] {
  const completed = events.filter(e => e.type === 'task:completed');
  const groups: Record<string, { count: number; scores: number[] }> = {};

  for (const e of completed) {
    const model = (e.metadata?.model as string) || 'unknown';
    if (!groups[model]) groups[model] = { count: 0, scores: [] };
    groups[model].count++;
    const score = e.metadata?.score as number | undefined;
    if (score !== undefined) groups[model].scores.push(score);
  }

  return Object.entries(groups)
    .map(([model, data]) => ({
      model,
      count: data.count,
      avgScore: data.scores.length > 0
        ? Math.round((data.scores.reduce((s, v) => s + v, 0) / data.scores.length) * 10) / 10
        : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const url = new URL(req.url);
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const sprintFilter = url.searchParams.get('sprint');
    const modelFilter = url.searchParams.get('model');
    const complexityFilter = url.searchParams.get('complexity');

    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setDate(defaultStart.getDate() - 90);

    const start = startDate ? new Date(startDate) : defaultStart;
    const end = endDate ? new Date(endDate) : now;

    const allEvents: PersistedEvent[] = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      const snapshot = await getDb().ref(`events/${projectId}/${date}`).once('value');
      const data = snapshot.val();
      if (!data) continue;
      for (const event of Object.values(data) as PersistedEvent[]) {
        allEvents.push(event);
      }
    }

    let filtered = allEvents;

    if (sprintFilter) {
      filtered = filtered.filter(e => (e.metadata?.sprint as string) === sprintFilter);
    }
    if (modelFilter) {
      filtered = filtered.filter(e => (e.metadata?.model as string) === modelFilter);
    }
    if (complexityFilter) {
      const ranges: Record<string, [number, number]> = {
        trivial: [1, 2],
        standard: [3, 5],
        complex: [8, 100],
      };
      const range = ranges[complexityFilter];
      if (range) {
        filtered = filtered.filter(e => {
          const pts = (e.metadata?.devPoints as number) || 0;
          return pts >= range[0] && pts <= range[1];
        });
      }
    }

    const sprints = [...new Set(allEvents
      .filter(e => e.metadata?.sprint)
      .map(e => e.metadata.sprint as string)
    )].sort();

    const models = [...new Set(allEvents
      .filter(e => e.metadata?.model)
      .map(e => e.metadata.model as string)
    )].sort();

    return NextResponse.json({
      velocity: buildVelocity(filtered),
      costPerSprint: buildCostPerSprint(filtered),
      reviewPassRate: buildReviewPassRate(filtered),
      durationByComplexity: buildDurationByComplexity(filtered),
      modelUsage: buildModelUsage(filtered),
      filters: { sprints, models },
      totalEvents: filtered.length,
      dateRange: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
