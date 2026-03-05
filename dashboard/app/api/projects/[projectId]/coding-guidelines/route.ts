import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/firebase';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const snapshot = await getDb().ref(`projects/${projectId}/codingGuidelines`).once('value');
    return NextResponse.json({ codingGuidelines: snapshot.val() || '' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const body = await req.json();
    const { codingGuidelines } = body;

    if (typeof codingGuidelines !== 'string') {
      return NextResponse.json({ error: 'codingGuidelines must be a string' }, { status: 400 });
    }

    if (codingGuidelines.length > 2000) {
      return NextResponse.json({ error: 'codingGuidelines cannot exceed 2000 characters' }, { status: 400 });
    }

    await getDb().ref(`projects/${projectId}/codingGuidelines`).set(codingGuidelines);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
