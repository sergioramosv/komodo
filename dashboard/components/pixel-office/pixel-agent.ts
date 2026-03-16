import type { Point } from './office-map';
import { TILE_SIZE, COFFEE_ZONE, WHITEBOARD_POS } from './office-map';
import { bfs } from './pathfinding';

export type PixelAgentFSMState = 'IDLE' | 'WALK' | 'SIT' | 'TYPE' | 'READ' | 'COFFEE';

/** FPS per FSM state for frame cycling */
export const FSM_FPS: Record<PixelAgentFSMState, number> = {
  IDLE: 4,
  WALK: 8,
  SIT: 4,
  TYPE: 8,
  READ: 4,
  COFFEE: 4,
};

/** Walk speed in tiles per second */
export const WALK_SPEED = 2;

type Direction = 'down' | 'up' | 'left' | 'right';

/** Agent color palettes for programmatic pixel art */
const AGENT_COLORS: Record<string, { body: string; hair: string; accent: string }> = {
  PLANNER:   { body: '#8b5cf6', hair: '#4c1d95', accent: '#c4b5fd' },
  ARCHITECT: { body: '#06b6d4', hair: '#164e63', accent: '#a5f3fc' },
  CODER:     { body: '#3b82f6', hair: '#1e3a5f', accent: '#93c5fd' },
  TESTER:    { body: '#f97316', hair: '#7c2d12', accent: '#fdba74' },
  SECURITY:  { body: '#22c55e', hair: '#14532d', accent: '#86efac' },
  REVIEWER:  { body: '#f59e0b', hair: '#78350f', accent: '#fde68a' },
};

export class PixelAgent {
  id: string;
  tileX: number;
  tileY: number;
  /** Pixel position for smooth movement */
  pixelX: number;
  pixelY: number;
  state: PixelAgentFSMState = 'IDLE';
  direction: Direction = 'down';
  frame: number = 0;
  private frameTimer: number = 0;
  private path: Point[] = [];
  private pathIndex: number = 0;
  private onArrival: (() => void) | null = null;
  private moveProgress: number = 0;
  private colors: { body: string; hair: string; accent: string };
  private homePos: Point = { x: 0, y: 0 };
  private idleMode: boolean = false;
  private wanderTimer: number = 0;
  private wanderInterval: number = 0;
  private isWandering: boolean = false;
  private isDwelling: boolean = false;
  private dwellTimer: number = 0;
  private dwellDuration: number = 0;

  constructor(id: string, startPos: Point) {
    this.id = id;
    this.tileX = startPos.x;
    this.tileY = startPos.y;
    this.pixelX = startPos.x * TILE_SIZE;
    this.pixelY = startPos.y * TILE_SIZE;
    this.homePos = { ...startPos };
    this.colors = AGENT_COLORS[id] ?? { body: '#6b7280', hair: '#374151', accent: '#d1d5db' };
  }

  /** Enable idle wandering — agent will periodically walk to coffee or whiteboard */
  enableIdleWander(): void {
    this.idleMode = true;
    this.isWandering = false;
    this.isDwelling = false;
    this.scheduleNextWander();
  }

  /** Disable idle wandering — call when agent gets a real task */
  disableIdleWander(): void {
    this.idleMode = false;
    this.isWandering = false;
    this.isDwelling = false;
  }

  private scheduleNextWander(): void {
    this.wanderTimer = 0;
    // 5–10 seconds between wanders
    this.wanderInterval = 5000 + Math.random() * 5000;
  }

  private triggerWander(): void {
    this.isWandering = true;
    const goToCoffee = Math.random() < 0.5;
    const waypoint = goToCoffee ? COFFEE_ZONE : WHITEBOARD_POS;
    const arrivalState: PixelAgentFSMState = goToCoffee ? 'COFFEE' : 'READ';
    this.dwellDuration = 3000 + Math.random() * 2000; // 3–5 seconds at waypoint
    this.setTarget(waypoint, () => {
      this.state = arrivalState;
      this.frame = 0;
      this.isDwelling = true;
      this.dwellTimer = 0;
    });
  }

  /** Set a target tile. Agent will BFS pathfind and walk there. */
  setTarget(target: Point, onArrival?: () => void) {
    const from = { x: this.tileX, y: this.tileY };
    const path = bfs(from, target);
    if (path.length === 0 && !(from.x === target.x && from.y === target.y)) {
      // No path found, just jump
      this.tileX = target.x;
      this.tileY = target.y;
      this.pixelX = target.x * TILE_SIZE;
      this.pixelY = target.y * TILE_SIZE;
      onArrival?.();
      return;
    }

    if (path.length === 0) {
      onArrival?.();
      return;
    }

    this.path = path;
    this.pathIndex = 0;
    this.moveProgress = 0;
    this.state = 'WALK';
    this.onArrival = onArrival ?? null;
  }

  /** Update agent state. deltaMs = milliseconds since last frame. */
  update(deltaMs: number) {
    const deltaSec = deltaMs / 1000;

    // Frame animation cycling
    const fps = FSM_FPS[this.state];
    this.frameTimer += deltaMs;
    const frameDuration = 1000 / fps;
    if (this.frameTimer >= frameDuration) {
      this.frame = (this.frame + 1) % 4;
      this.frameTimer -= frameDuration;
    }

    // Movement
    if (this.state === 'WALK' && this.path.length > 0) {
      this.moveProgress += WALK_SPEED * deltaSec;

      while (this.moveProgress >= 1 && this.pathIndex < this.path.length) {
        const next = this.path[this.pathIndex];
        // Update direction
        const dx = next.x - this.tileX;
        const dy = next.y - this.tileY;
        if (Math.abs(dx) > Math.abs(dy)) {
          this.direction = dx > 0 ? 'right' : 'left';
        } else {
          this.direction = dy > 0 ? 'down' : 'up';
        }

        this.tileX = next.x;
        this.tileY = next.y;
        this.pathIndex++;
        this.moveProgress -= 1;
      }

      // Smooth pixel interpolation
      if (this.pathIndex < this.path.length) {
        const next = this.path[this.pathIndex];
        const dx = next.x - this.tileX;
        const dy = next.y - this.tileY;
        if (Math.abs(dx) > Math.abs(dy)) {
          this.direction = dx > 0 ? 'right' : 'left';
        } else if (dy !== 0) {
          this.direction = dy > 0 ? 'down' : 'up';
        }
        const progress = Math.min(this.moveProgress, 1);
        this.pixelX = (this.tileX + dx * progress) * TILE_SIZE;
        this.pixelY = (this.tileY + dy * progress) * TILE_SIZE;
      } else {
        // Arrived
        this.pixelX = this.tileX * TILE_SIZE;
        this.pixelY = this.tileY * TILE_SIZE;
        this.path = [];
        this.pathIndex = 0;
        this.moveProgress = 0;
        const cb = this.onArrival;
        this.onArrival = null;
        cb?.();
      }
    } else {
      // Snap to tile when not walking
      this.pixelX = this.tileX * TILE_SIZE;
      this.pixelY = this.tileY * TILE_SIZE;
    }

    // Idle wander logic
    if (this.idleMode) {
      if (this.isDwelling) {
        this.dwellTimer += deltaMs;
        if (this.dwellTimer >= this.dwellDuration) {
          this.isDwelling = false;
          this.setTarget(this.homePos, () => {
            this.state = 'IDLE';
            this.frame = 0;
            this.isWandering = false;
            this.scheduleNextWander();
          });
        }
      } else if (!this.isWandering) {
        this.wanderTimer += deltaMs;
        if (this.wanderTimer >= this.wanderInterval) {
          this.triggerWander();
        }
      }
    }
  }

  /** Draw the agent on a 2D canvas context */
  drawSelf(ctx: CanvasRenderingContext2D) {
    const x = Math.round(this.pixelX);
    const y = Math.round(this.pixelY);
    const s = TILE_SIZE;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(x + 2, y + s - 3, s - 4, 3);

    // Body
    ctx.fillStyle = this.colors.body;
    ctx.fillRect(x + 4, y + 8, s - 8, s - 10);

    // Head
    ctx.fillStyle = '#fcd6b4'; // skin
    ctx.fillRect(x + 5, y + 2, s - 10, 7);

    // Hair
    ctx.fillStyle = this.colors.hair;
    ctx.fillRect(x + 5, y + 1, s - 10, 3);

    // Eyes (direction-dependent)
    ctx.fillStyle = '#1a1a1a';
    if (this.direction === 'down') {
      ctx.fillRect(x + 7, y + 5, 2, 2);
      ctx.fillRect(x + 11, y + 5, 2, 2);
    } else if (this.direction === 'up') {
      // No eyes visible from back
    } else if (this.direction === 'left') {
      ctx.fillRect(x + 6, y + 5, 2, 2);
    } else {
      ctx.fillRect(x + 12, y + 5, 2, 2);
    }

    // Walk animation: leg bob
    if (this.state === 'WALK') {
      const legOffset = this.frame % 2 === 0 ? 0 : 1;
      ctx.fillStyle = this.colors.hair;
      ctx.fillRect(x + 6, y + s - 4 + legOffset, 3, 3);
      ctx.fillRect(x + 11, y + s - 4 - legOffset, 3, 3);
    } else {
      // Standing legs
      ctx.fillStyle = this.colors.hair;
      ctx.fillRect(x + 6, y + s - 4, 3, 3);
      ctx.fillRect(x + 11, y + s - 4, 3, 3);
    }

    // Type animation: hand movement
    if (this.state === 'TYPE') {
      ctx.fillStyle = this.colors.accent;
      const handX = this.frame % 2 === 0 ? x + 3 : x + 4;
      ctx.fillRect(handX, y + 10, 3, 2);
      ctx.fillRect(x + s - 6 - (this.frame % 2), y + 10, 3, 2);
    }

    // Coffee: draw cup
    if (this.state === 'COFFEE') {
      ctx.fillStyle = '#92400e';
      ctx.fillRect(x + s - 4, y + 8, 4, 5);
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(x + s - 3, y + 9, 2, 3);
      // Steam
      if (this.frame % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(x + s - 3, y + 6, 1, 2);
      }
    }

    // Read: draw book in left hand
    if (this.state === 'READ') {
      ctx.fillStyle = '#1e40af';                          // book cover (dark blue)
      ctx.fillRect(x + 1, y + 8, 4, 5);                  // left hand, same height as COFFEE
      ctx.fillStyle = '#f8fafc';                          // pages (white)
      ctx.fillRect(x + 2, y + 9, 2, 3);
      if (this.frame % 2 === 0) {                         // page-turn animation
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(x + 2, y + 9, 1, 3);                // left page visible
      }
    }

    // Name tag
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    const label = this.id.slice(0, 4);
    const textWidth = ctx.measureText(label).width;
    ctx.fillRect(x + s / 2 - textWidth / 2 - 1, y - 4, textWidth + 2, 7);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x + s / 2, y + 2);
    ctx.textAlign = 'start';
  }
}
