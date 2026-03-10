import { getAll, getById } from './skills/planning-task-mcp/src/firebase.js';

async function main() {
  try {
    const projectId = 'komodo';
    const project = await getById('projects', projectId);
    console.log('PROJECT_START');
    console.log(JSON.stringify(project));
    console.log('PROJECT_END');

    const sprints = await getAll('sprints');
    const activeSprints = sprints.filter(s => s.projectId === projectId && s.status === 'active');
    console.log('SPRINTS_START');
    console.log(JSON.stringify(activeSprints));
    console.log('SPRINTS_END');

    const tasks = await getAll('tasks');
    const projectTasks = tasks.filter(t => t.projectId === projectId);
    console.log('TASKS_START');
    console.log(JSON.stringify(projectTasks));
    console.log('TASKS_END');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
