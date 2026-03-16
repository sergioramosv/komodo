/**
 * Detects multi-part tasks by title pattern like "(2/4)" or "(Part 3 of 5)"
 * and checks if all previous parts are done.
 *
 * @param {Object} task - The task to check
 * @param {Array} allTasks - All project tasks
 * @returns {Array<{id: string, title: string, status: string}>} Unresolved previous parts
 */
export function getUnresolvedPreviousParts(task, allTasks) {
  const title = task.title || '';

  // Match patterns: (2/4), (Part 2 of 4), [2/4], (2 of 4)
  const match = title.match(/[\[(]\s*(?:Part\s+)?(\d+)\s*(?:\/|of)\s*(\d+)\s*[\])]/i);
  if (!match) return [];

  const partNum = parseInt(match[1], 10);
  if (partNum <= 1) return []; // Part 1 is never blocked

  // Extract base title (everything before the part pattern)
  const baseTitle = title.slice(0, title.indexOf(match[0])).trim().toLowerCase();

  const unresolved = [];
  for (let i = 1; i < partNum; i++) {
    const prevPart = allTasks.find(t => {
      const tTitle = (t.title || '').toLowerCase();
      const tMatch = tTitle.match(/[\[(]\s*(?:part\s+)?(\d+)\s*(?:\/|of)\s*(\d+)\s*[\])]/i);
      if (!tMatch) return false;
      const tPartNum = parseInt(tMatch[1], 10);
      const tBase = tTitle.slice(0, tTitle.indexOf(tMatch[0])).trim();
      return tBase === baseTitle && tPartNum === i;
    });

    if (!prevPart || prevPart.status !== 'done') {
      unresolved.push({
        id: prevPart?.id || `(part ${i} not found)`,
        title: prevPart?.title || `${baseTitle} (${i}/?)`,
        status: prevPart?.status || '(not found)',
      });
    }
  }

  return unresolved;
}
