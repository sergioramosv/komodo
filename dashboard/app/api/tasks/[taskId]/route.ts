import { NextResponse } from 'next/server';
import { getDb } from '@/lib/firebase';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const snapshot = await getDb().ref(`tasks/${taskId}`).once('value');
    const task = snapshot.val();

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const db = getDb();

    // Resolve sprint name, developer name, co-developer name in parallel
    const [sprintName, developerName, coDeveloperName] = await Promise.all([
      task.sprintId
        ? db.ref(`sprints/${task.sprintId}`).once('value').then(s => {
            const v = s.val();
            return v?.name || v?.title || null;
          }).catch(() => null)
        : Promise.resolve(null),
      task.developer
        ? db.ref(`users/${task.developer}`).once('value').then(s => {
            const v = s.val();
            return v?.displayName || null;
          }).catch(() => null)
        : Promise.resolve(null),
      task.coDeveloper
        ? db.ref(`users/${task.coDeveloper}`).once('value').then(s => {
            const v = s.val();
            return v?.displayName || null;
          }).catch(() => null)
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      ...task,
      id: taskId,
      sprintName,
      developerName: developerName || task.developer,
      coDeveloperName: coDeveloperName || task.coDeveloper,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
