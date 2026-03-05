import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/firebase';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const snapshot = await getDb().ref('tasks').once('value');
    const data = snapshot.val();

    if (!data) {
      return NextResponse.json({ techDebt: [], count: 0, trend: 0 });
    }

    const allTasks = Object.entries(data).map(([id, val]) => ({
      id,
      ...(val as Record<string, unknown>),
    }));

    // Filter tech-debt tasks for this project
    const techDebtTasks = allTasks.filter(
      (t) => t.projectId === projectId && t.source === 'tech-debt',
    );

    // Count by status for trend
    const open = techDebtTasks.filter((t) => t.status === 'to-do').length;
    const done = techDebtTasks.filter((t) => t.status === 'done').length;
    const trend = open - done; // positive = growing debt, negative = shrinking

    return NextResponse.json({
      techDebt: techDebtTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        severity: t.techDebtSeverity,
        file: t.techDebtFile,
        description: t.techDebtDescription,
        devPoints: t.devPoints,
        originPrNumber: t.originPrNumber,
        createdAt: t.createdAt,
      })),
      count: techDebtTasks.length,
      open,
      done,
      trend,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
