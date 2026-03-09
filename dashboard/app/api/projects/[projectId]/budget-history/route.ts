import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/firebase';

export interface DailyCostEntry {
  date: string;
  totalCost: number;
  updatedAt: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const url = new URL(req.url);

    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setDate(defaultStart.getDate() - 30);

    const startDate = url.searchParams.get('startDate') ?? defaultStart.toISOString().slice(0, 10);
    const endDate = url.searchParams.get('endDate') ?? now.toISOString().slice(0, 10);

    const ref = getDb().ref(`budgets/${projectId}/daily`);
    const snapshot = await ref.orderByKey().startAt(startDate).endAt(endDate).once('value');

    const data = snapshot.val() as Record<string, DailyCostEntry> | null;
    const entries: DailyCostEntry[] = data
      ? Object.values(data).sort((a, b) => a.date.localeCompare(b.date))
      : [];

    return NextResponse.json({ history: entries, startDate, endDate });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
