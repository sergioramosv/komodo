import type { AgentName } from '@/lib/types';
import type { TileType } from './office-map';
import {
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  TILE_MAP,
  SORTABLE_FURNITURE,
  FURNITURE_SORT_OFFSETS,
} from './office-map';
import type { Camera } from './camera';
import type { PixelAgent } from './pixel-agent';

const TILE_COLORS: Record<TileType, string> = {
  floor: '#2d2d3d',
  wall: '#1a1a2e',
  desk: '#5c4033',
  carpet: '#3d2d4d',
  coffee: '#4a3728',
  whiteboard: '#e8e8e8',
};

const FLOOR_ALT = '#32324a';

/** 4-bit bitmask for wall auto-tiling: N=1, E=2, S=4, W=8 */
const WALL_TINT: Record<number, string> = {
  // Corner/edge variations — subtle shade differences
  0: '#1a1a2e',   // isolated
  5: '#1e1e34',   // N+S (vertical)
  10: '#1e1e34',  // E+W (horizontal)
  15: '#222238',  // all 4 (cross)
};

/** Check if tile at (x,y) is a wall */
function isWall(x: number, y: number): boolean {
  if (x < 0 || x >= GRID_COLS || y < 0 || y >= GRID_ROWS) return true;
  return TILE_MAP[y][x] === 'wall';
}

/** Compute 4-bit bitmask for wall neighbors */
function wallBitmask(x: number, y: number): number {
  let mask = 0;
  if (isWall(x, y - 1)) mask |= 1; // N
  if (isWall(x + 1, y)) mask |= 2; // E
  if (isWall(x, y + 1)) mask |= 4; // S
  if (isWall(x - 1, y)) mask |= 8; // W
  return mask;
}

/** Pre-computed wall bitmasks */
const WALL_MASKS: number[][] = [];
for (let y = 0; y < GRID_ROWS; y++) {
  WALL_MASKS[y] = [];
  for (let x = 0; x < GRID_COLS; x++) {
    WALL_MASKS[y][x] = TILE_MAP[y][x] === 'wall' ? wallBitmask(x, y) : 0;
  }
}

interface SortableEntity {
  sortY: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

export class Renderer {
  private hoveredAgent: AgentName | null = null;
  private selectedAgent: AgentName | null = null;

  setHoveredAgent(name: AgentName | null) {
    this.hoveredAgent = name;
  }

  setSelectedAgent(name: AgentName | null) {
    this.selectedAgent = name;
  }

  /** Full render pipeline: floor → walls → entities z-sorted → overlays */
  render(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    agents: Map<AgentName, PixelAgent>,
  ) {
    const { viewportW, viewportH } = camera;

    // Clear with bg color
    camera.resetTransform(ctx);
    ctx.fillStyle = '#111118';
    ctx.fillRect(0, 0, viewportW, viewportH);

    // Apply camera transform for world-space drawing
    camera.applyTransform(ctx);
    ctx.imageSmoothingEnabled = false;

    // Layer 1: Floor tiles
    this.drawFloor(ctx);

    // Layer 2: Walls with auto-tiling
    this.drawWalls(ctx);

    // Layer 3: Grid lines (subtle)
    this.drawGrid(ctx);

    // Layer 4: Z-sorted entities (furniture + agents)
    this.drawEntitiesSorted(ctx, agents);

    // Layer 5: Overlays (selection/hover indicators) — drawn in world space
    this.drawOverlays(ctx, agents);

    // Reset transform
    camera.resetTransform(ctx);
  }

  private drawFloor(ctx: CanvasRenderingContext2D) {
    for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x < GRID_COLS; x++) {
        const tileType = TILE_MAP[y][x];
        if (tileType === 'wall') continue; // drawn separately

        if (tileType === 'floor') {
          ctx.fillStyle = (x + y) % 2 === 0 ? TILE_COLORS.floor : FLOOR_ALT;
        } else if (tileType === 'carpet') {
          ctx.fillStyle = TILE_COLORS.carpet;
        } else {
          // Furniture tiles get floor underneath
          ctx.fillStyle = (x + y) % 2 === 0 ? TILE_COLORS.floor : FLOOR_ALT;
        }
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  private drawWalls(ctx: CanvasRenderingContext2D) {
    for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x < GRID_COLS; x++) {
        if (TILE_MAP[y][x] !== 'wall') continue;

        const mask = WALL_MASKS[y][x];
        ctx.fillStyle = WALL_TINT[mask] ?? TILE_COLORS.wall;
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

        // Edge highlights based on bitmask
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        if (!(mask & 1)) {
          // No wall to north — draw top edge
          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, 1);
        }
        if (!(mask & 8)) {
          // No wall to west — draw left edge
          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, 1, TILE_SIZE);
        }

        // Inner shadow
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        if (!(mask & 4)) {
          // No wall to south — draw bottom shadow
          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE + TILE_SIZE - 1, TILE_SIZE, 1);
        }
        if (!(mask & 2)) {
          // No wall to east — draw right shadow
          ctx.fillRect(x * TILE_SIZE + TILE_SIZE - 1, y * TILE_SIZE, 1, TILE_SIZE);
        }
      }
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= GRID_COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * TILE_SIZE, 0);
      ctx.lineTo(x * TILE_SIZE, GRID_ROWS * TILE_SIZE);
      ctx.stroke();
    }
    for (let y = 0; y <= GRID_ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * TILE_SIZE);
      ctx.lineTo(GRID_COLS * TILE_SIZE, y * TILE_SIZE);
      ctx.stroke();
    }
  }

  private drawEntitiesSorted(
    ctx: CanvasRenderingContext2D,
    agents: Map<AgentName, PixelAgent>,
  ) {
    const entities: SortableEntity[] = [];

    // Add furniture as sortable entities
    for (const f of SORTABLE_FURNITURE) {
      const sortY = f.y * TILE_SIZE + FURNITURE_SORT_OFFSETS[f.type];
      entities.push({
        sortY,
        draw: (c) => this.drawFurnitureTile(c, f.x, f.y, f.type),
      });
    }

    // Add agents as sortable entities
    for (const agent of agents.values()) {
      entities.push({
        sortY: agent.pixelY + TILE_SIZE, // sort by bottom edge
        draw: (c) => agent.drawSelf(c),
      });
    }

    // Sort by Y (depth ordering)
    entities.sort((a, b) => a.sortY - b.sortY);

    for (const entity of entities) {
      entity.draw(ctx);
    }
  }

  private drawFurnitureTile(ctx: CanvasRenderingContext2D, x: number, y: number, type: TileType) {
    const px = x * TILE_SIZE;
    const py = y * TILE_SIZE;

    ctx.fillStyle = TILE_COLORS[type];
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

    if (type === 'desk') {
      // Monitor
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(px + 4, py + 3, 12, 8);
      // Screen glow
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(px + 5, py + 4, 10, 6);
    } else if (type === 'whiteboard') {
      ctx.fillStyle = '#374151';
      ctx.fillRect(px + 2, py + 4, 6, 1);
      ctx.fillRect(px + 2, py + 8, 10, 1);
      ctx.fillRect(px + 2, py + 12, 8, 1);
    } else if (type === 'coffee') {
      ctx.fillStyle = '#78350f';
      ctx.fillRect(px + 4, py + 2, 12, 14);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(px + 6, py + 5, 2, 2);
    }
  }

  private drawOverlays(
    ctx: CanvasRenderingContext2D,
    agents: Map<AgentName, PixelAgent>,
  ) {
    // Hover highlight
    if (this.hoveredAgent) {
      const agent = agents.get(this.hoveredAgent);
      if (agent) {
        const px = Math.round(agent.pixelX);
        const py = Math.round(agent.pixelY);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px - 1, py - 5, TILE_SIZE + 2, TILE_SIZE + 7);
      }
    }

    // Selection highlight
    if (this.selectedAgent) {
      const agent = agents.get(this.selectedAgent);
      if (agent) {
        const px = Math.round(agent.pixelX);
        const py = Math.round(agent.pixelY);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px - 2, py - 6, TILE_SIZE + 4, TILE_SIZE + 9);
      }
    }
  }
}
