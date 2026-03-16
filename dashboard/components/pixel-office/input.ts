import type { AgentName } from '@/lib/types';
import { TILE_SIZE } from './office-map';
import type { Camera } from './camera';
import type { PixelAgent } from './pixel-agent';

export interface InputCallbacks {
  onAgentClick?: (name: AgentName | null) => void;
  onAgentHover?: (name: AgentName | null) => void;
}

export class InputHandler {
  private canvas: HTMLCanvasElement | null = null;
  private camera: Camera;
  private agents: () => Map<AgentName, PixelAgent>;
  private callbacks: InputCallbacks;

  private isPanning = false;
  private lastPanX = 0;
  private lastPanY = 0;

  // Bound handlers for cleanup
  private handleMouseDown: (e: MouseEvent) => void;
  private handleMouseMove: (e: MouseEvent) => void;
  private handleMouseUp: (e: MouseEvent) => void;
  private handleWheel: (e: WheelEvent) => void;
  private handleContextMenu: (e: MouseEvent) => void;

  constructor(
    camera: Camera,
    agentsGetter: () => Map<AgentName, PixelAgent>,
    callbacks: InputCallbacks = {},
  ) {
    this.camera = camera;
    this.agents = agentsGetter;
    this.callbacks = callbacks;

    this.handleMouseDown = this.onMouseDown.bind(this);
    this.handleMouseMove = this.onMouseMove.bind(this);
    this.handleMouseUp = this.onMouseUp.bind(this);
    this.handleWheel = this.onWheel.bind(this);
    this.handleContextMenu = (e: MouseEvent) => e.preventDefault();
  }

  /** Attach event listeners to canvas */
  mount(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.addEventListener('mousedown', this.handleMouseDown);
    canvas.addEventListener('mousemove', this.handleMouseMove);
    canvas.addEventListener('mouseup', this.handleMouseUp);
    canvas.addEventListener('mouseleave', this.handleMouseUp);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.handleContextMenu);
  }

  /** Remove all event listeners */
  unmount() {
    if (!this.canvas) return;
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('mouseleave', this.handleMouseUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.canvas = null;
  }

  private getCanvasPos(e: MouseEvent): { x: number; y: number } {
    if (!this.canvas) return { x: 0, y: 0 };
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private hitTestAgent(worldX: number, worldY: number): AgentName | null {
    const map = this.agents();
    for (const [name, agent] of map) {
      const ax = agent.pixelX;
      const ay = agent.pixelY;
      // Hit box: the agent sprite area
      if (
        worldX >= ax && worldX < ax + TILE_SIZE &&
        worldY >= ay - 5 && worldY < ay + TILE_SIZE + 2
      ) {
        return name;
      }
    }
    return null;
  }

  private onMouseDown(e: MouseEvent) {
    // Middle mouse or left mouse for pan
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      // Middle click or shift+left for pan
      this.isPanning = true;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      e.preventDefault();
      return;
    }

    if (e.button === 0) {
      // Left click — check for agent click
      const pos = this.getCanvasPos(e);
      const world = this.camera.screenToWorld(pos.x, pos.y);
      const hit = this.hitTestAgent(world.x, world.y);
      this.callbacks.onAgentClick?.(hit);

      // If no agent hit, start pan
      if (!hit) {
        this.isPanning = true;
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
      }
    }
  }

  private onMouseMove(e: MouseEvent) {
    if (this.isPanning) {
      const dx = e.clientX - this.lastPanX;
      const dy = e.clientY - this.lastPanY;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this.camera.pan(dx, dy);
      return;
    }

    // Hover detection
    const pos = this.getCanvasPos(e);
    const world = this.camera.screenToWorld(pos.x, pos.y);
    const hit = this.hitTestAgent(world.x, world.y);
    this.callbacks.onAgentHover?.(hit);

    // Cursor style
    if (this.canvas) {
      this.canvas.style.cursor = hit ? 'pointer' : 'grab';
    }
  }

  private onMouseUp(_e: MouseEvent) {
    if (this.isPanning) {
      this.isPanning = false;
      if (this.canvas) {
        this.canvas.style.cursor = 'grab';
      }
    }
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    this.camera.setZoom(this.camera.zoom + delta);
  }
}
