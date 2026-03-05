import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/firebase';
import type { CoverageEntry } from '@/types/coverage';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const snapshot = await getDb()
      .ref(`metrics/${projectId}/coverageHistory`)
      .orderByChild('timestamp')
      .limitToLast(50)
      .once('value');

    const data = snapshot.val();

    if (!data) {
      return NextResponse.json({ history: [], current: null });
    }

    const history: CoverageEntry[] = Object.values(data);
    history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const latest = history[history.length - 1];

    return NextResponse.json({
      history,
      current: latest?.coverage ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
