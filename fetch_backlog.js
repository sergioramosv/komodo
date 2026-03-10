import { getAll } from './skills/planning-task-mcp/src/firebase.js';

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('Usage: node fetch_backlog.js <projectId>');
    process.exit(1);
  }

  try {
    const sprints = await getAll('sprints');
    const activeSprints = sprints.filter(s => s.projectId === projectId && s.status === 'active');
    
    const tasks = await getAll('tasks');
    const projectTasks = tasks.filter(t => t.projectId === projectId);

    console.log(JSON.stringify({
      sprints: activeSprints,
      tasks: projectTasks
    }, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
