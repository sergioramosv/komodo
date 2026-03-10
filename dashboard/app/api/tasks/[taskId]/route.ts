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

    // Resolve sprint name if sprintId exists
    let sprintName: string | null = null;
    if (task.sprintId) {
      try {
        const sprintSnap = await getDb().ref(`sprints/${task.sprintId}`).once('value');
        const sprint = sprintSnap.val();
        if (sprint) {
          sprintName = sprint.name || sprint.title || task.sprintId;
        }
      } catch {
        // Ignore sprint lookup errors
      }
    }

    return NextResponse.json({
      ...task,
      id: taskId,
      sprintName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
