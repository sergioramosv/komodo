import { NextResponse } from 'next/server';
import { getDb } from '@/lib/firebase';

export async function GET() {
  try {
    const userId = process.env.DEFAULT_USER_ID || '';
    const snapshot = await getDb().ref('projects').once('value');
    const data = snapshot.val();

    if (!data) {
      return NextResponse.json({ projects: [] });
    }

    const all = Object.entries(data).map(([id, val]) => ({
      id,
      ...(val as Record<string, unknown>),
    }));

    // Filter by user membership if userId is set
    const projects = userId
      ? all.filter((p) => {
          const members = (p as Record<string, unknown>).members as
            | Record<string, unknown>
            | undefined;
          return members && members[userId];
        })
      : all;

    return NextResponse.json({
      projects: projects.map((p) => ({
        id: p.id,
        name: (p as Record<string, unknown>).name || p.id,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ projects: [], error: message }, { status: 500 });
  }
}
