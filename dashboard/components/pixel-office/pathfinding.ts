import type { Point } from './office-map';
import { GRID_COLS, GRID_ROWS, COLLISION_MAP } from './office-map';

const DIRECTIONS: Point[] = [
  { x: 0, y: -1 }, // up
  { x: 0, y: 1 },  // down
  { x: -1, y: 0 }, // left
  { x: 1, y: 0 },  // right
];

/**
 * BFS pathfinding on the grid.
 * Returns array of Points (tile coords) from `from` to `to`, excluding `from`.
 * Returns empty array if no path found.
 */
export function bfs(from: Point, to: Point): Point[] {
  if (from.x === to.x && from.y === to.y) return [];

  const key = (p: Point) => `${p.x},${p.y}`;
  const visited = new Set<string>();
  const parent = new Map<string, Point | null>();

  visited.add(key(from));
  parent.set(key(from), null);

  const queue: Point[] = [from];
  let found = false;

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.x === to.x && current.y === to.y) {
      found = true;
      break;
    }

    for (const dir of DIRECTIONS) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      const next: Point = { x: nx, y: ny };
      const nk = key(next);

      if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
      if (visited.has(nk)) continue;

      // Allow destination even if it's on a collision tile (agent sits at desk)
      const isDestination = nx === to.x && ny === to.y;
      if (!isDestination && COLLISION_MAP[ny][nx] === 1) continue;

      visited.add(nk);
      parent.set(nk, current);
      queue.push(next);
    }
  }

  if (!found) return [];

  // Reconstruct path
  const path: Point[] = [];
  let current: Point | null = to;
  while (current && !(current.x === from.x && current.y === from.y)) {
    path.unshift(current);
    current = parent.get(key(current)) ?? null;
  }

  return path;
}
