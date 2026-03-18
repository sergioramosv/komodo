import type { AgentName } from '@/lib/types';

export const GRID_COLS = 32;
export const GRID_ROWS = 24;
export const TILE_SIZE = 20;
export const CANVAS_WIDTH = GRID_COLS * TILE_SIZE;   // 640
export const CANVAS_HEIGHT = GRID_ROWS * TILE_SIZE;  // 480

export interface Point {
  x: number;
  y: number;
}

/** Tile types for rendering */
export type TileType = 'floor' | 'wall' | 'desk' | 'carpet' | 'coffee' | 'whiteboard';

/**
 * Build the office layout grid.
 * 0 = walkable floor, 1 = wall/obstacle
 */
function buildCollisionMap(): number[][] {
  const map: number[][] = [];
  for (let y = 0; y < GRID_ROWS; y++) {
    map[y] = [];
    for (let x = 0; x < GRID_COLS; x++) {
      // Walls on border
      if (y === 0 || y === GRID_ROWS - 1 || x === 0 || x === GRID_COLS - 1) {
        map[y][x] = 1;
      } else {
        map[y][x] = 0;
      }
    }
  }

  // Desk blocks (2x1 each) — 6 desks in two rows
  const deskPositions = [
    // Row 1 (top): PLANNER, ARCHITECT, CODER
    { x: 5, y: 4 }, { x: 6, y: 4 },
    { x: 12, y: 4 }, { x: 13, y: 4 },
    { x: 19, y: 4 }, { x: 20, y: 4 },
    // Row 2 (bottom): TESTER, SECURITY, REVIEWER
    { x: 5, y: 12 }, { x: 6, y: 12 },
    { x: 12, y: 12 }, { x: 13, y: 12 },
    { x: 19, y: 12 }, { x: 20, y: 12 },
  ];
  for (const p of deskPositions) {
    map[p.y][p.x] = 1;
  }

  // Whiteboard (top-right area)
  for (let x = 26; x <= 29; x++) {
    map[2][x] = 1;
  }

  // Coffee machine area (bottom-right)
  map[19][27] = 1;
  map[19][28] = 1;

  return map;
}

export const COLLISION_MAP = buildCollisionMap();

/**
 * Build visual tile type map for rendering.
 */
function buildTileMap(): TileType[][] {
  const tiles: TileType[][] = [];
  for (let y = 0; y < GRID_ROWS; y++) {
    tiles[y] = [];
    for (let x = 0; x < GRID_COLS; x++) {
      if (y === 0 || y === GRID_ROWS - 1 || x === 0 || x === GRID_COLS - 1) {
        tiles[y][x] = 'wall';
      } else {
        tiles[y][x] = 'floor';
      }
    }
  }

  // Carpet in center area
  for (let y = 8; y <= 10; y++) {
    for (let x = 10; x <= 22; x++) {
      tiles[y][x] = 'carpet';
    }
  }

  // Desks
  const deskTiles = [
    { x: 5, y: 4 }, { x: 6, y: 4 },
    { x: 12, y: 4 }, { x: 13, y: 4 },
    { x: 19, y: 4 }, { x: 20, y: 4 },
    { x: 5, y: 12 }, { x: 6, y: 12 },
    { x: 12, y: 12 }, { x: 13, y: 12 },
    { x: 19, y: 12 }, { x: 20, y: 12 },
  ];
  for (const p of deskTiles) {
    tiles[p.y][p.x] = 'desk';
  }

  // Whiteboard
  for (let x = 26; x <= 29; x++) {
    tiles[2][x] = 'whiteboard';
  }

  // Coffee area
  tiles[19][27] = 'coffee';
  tiles[19][28] = 'coffee';

  return tiles;
}

export const TILE_MAP = buildTileMap();

/** Where each agent sits (tile in front of desk) */
export const AGENT_DESKS: Record<AgentName, Point> = {
  PLANNER:   { x: 5, y: 5 },
  ARCHITECT: { x: 12, y: 5 },
  CODER:     { x: 19, y: 5 },
  TESTER:    { x: 5, y: 13 },
  SECURITY:  { x: 12, y: 13 },
  REVIEWER:  { x: 19, y: 13 },
};

/** Where agents go when idle (lounge area) */
export const AGENT_IDLE_ZONES: Record<AgentName, Point> = {
  PLANNER:   { x: 3, y: 20 },
  ARCHITECT: { x: 6, y: 20 },
  CODER:     { x: 9, y: 20 },
  TESTER:    { x: 12, y: 20 },
  SECURITY:  { x: 15, y: 20 },
  REVIEWER:  { x: 18, y: 20 },
};

export const COFFEE_ZONE: Point = { x: 26, y: 19 };
export const WHITEBOARD_POS: Point = { x: 27, y: 3 };
