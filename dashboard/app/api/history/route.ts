import { NextResponse } from 'next/server';
import { getDb } from '@/lib/firebase';

const HISTORY_REF = 'komodo-history';

/** Events worth persisting to history. */
const TRACKED_EVENTS = new Set([
  'task:started',
  'task:completed',
  'pr:created',
  'pr:merged',
  'review:cycle:end',
  'fix:applied',
  'sonar:analysis:complete',
]);

/** Whether Firebase is available. Avoids retrying after first failure. */
let firebaseAvailable: boolean | null = null;

/* ── POST: save a history entry ── */
export async function POST(request: Request) {
  // Skip silently if Firebase was already detected as unavailable
  if (firebaseAvailable === false) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    const body = await request.json();
    const { action, timestamp, agent, taskId, taskTitle, prNumber, repo, metadata } = body;

    if (!action || !TRACKED_EVENTS.has(action)) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const db = getDb();
    firebaseAvailable = true;

    const ref = db.ref(HISTORY_REF).push();

    const entry = {
      action,
      timestamp: timestamp || new Date().toISOString(),
      agent: agent || null,
      taskId: taskId || null,
      taskTitle: taskTitle || null,
      prNumber: prNumber || null,
      repo: repo || null,
      metadata: metadata || {},
    };

    await ref.set(entry);

    return NextResponse.json({ ok: true, id: ref.key });
  } catch (err) {
    // Mark Firebase as unavailable so we stop retrying
    firebaseAvailable = false;
    return NextResponse.json({ ok: true, skipped: true });
  }
}

/* ── GET: query history with filters ── */
export async function GET(request: Request) {
  if (firebaseAvailable === false) {
    return NextResponse.json({ entries: [], total: 0 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const actionFilter = searchParams.get('action');
    const agentFilter = searchParams.get('agent');
    const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10), 1000);

    const db = getDb();
    firebaseAvailable = true;
    let query = db.ref(HISTORY_REF).orderByChild('timestamp');

    if (startDate) {
      query = query.startAt(new Date(startDate).toISOString());
    }
    if (endDate) {
      // End of day
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query = query.endAt(end.toISOString());
    }

    const snapshot = await query.limitToLast(limit).once('value');
    const raw = snapshot.val();

    if (!raw) {
      return NextResponse.json({ entries: [], total: 0 });
    }

    interface RawEntry {
      action?: string;
      agent?: string;
      timestamp?: string;
      [key: string]: unknown;
    }

    let entries: (RawEntry & { id: string })[] = Object.entries(raw).map(([id, data]) => ({
      id,
      ...(data as RawEntry),
    }));

    // Client-side filters (Firebase RTDB only supports one orderBy)
    if (actionFilter) {
      entries = entries.filter((e) => e.action === actionFilter);
    }
    if (agentFilter) {
      entries = entries.filter((e) => e.agent === agentFilter);
    }

    // Sort newest first
    entries.sort((a, b) => {
      const ta = (a.timestamp as string) || '';
      const tb = (b.timestamp as string) || '';
      return tb.localeCompare(ta);
    });

    return NextResponse.json({ entries, total: entries.length });
  } catch {
    firebaseAvailable = false;
    return NextResponse.json({ entries: [], total: 0 });
  }
}
