import { CANVAS_WIDTH, CANVAS_HEIGHT, TILE_SIZE } from './office-map';

/** Integer zoom levels for pixel-perfect rendering */
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/** Lerp speed for follow mode (0-1 per second, higher = faster) */
const FOLLOW_LERP_SPEED = 4;

export class Camera {
  /** Offset in world pixels (top-left corner of viewport in world space) */
  offsetX = 0;
  offsetY = 0;
  /** Integer zoom 1x-4x */
  zoom = 1;
  /** Viewport size in CSS pixels */
  viewportW: number;
  viewportH: number;
  /** Follow mode target (world pixel coords) */
  private followTargetX: number | null = null;
  private followTargetY: number | null = null;

  constructor(viewportW: number, viewportH: number) {
    this.viewportW = viewportW;
    this.viewportH = viewportH;
  }

  /** Set integer zoom level, clamped 1-4. Zooms toward center of viewport. */
  setZoom(newZoom: number) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(newZoom)));
    if (clamped === this.zoom) return;

    // Zoom toward viewport center
    const centerWorldX = this.offsetX + this.viewportW / (2 * this.zoom);
    const centerWorldY = this.offsetY + this.viewportH / (2 * this.zoom);

    this.zoom = clamped;

    this.offsetX = centerWorldX - this.viewportW / (2 * this.zoom);
    this.offsetY = centerWorldY - this.viewportH / (2 * this.zoom);

    this.clampBounds();
  }

  /** Pan by delta in screen pixels */
  pan(screenDx: number, screenDy: number) {
    this.offsetX -= screenDx / this.zoom;
    this.offsetY -= screenDy / this.zoom;
    this.clampBounds();
    // Panning disables follow mode
    this.followTargetX = null;
    this.followTargetY = null;
  }

  /** Enable follow mode: smoothly center on a world-pixel position */
  followWorld(worldX: number, worldY: number) {
    this.followTargetX = worldX;
    this.followTargetY = worldY;
  }

  /** Disable follow mode */
  stopFollow() {
    this.followTargetX = null;
    this.followTargetY = null;
  }

  /** Whether follow mode is active */
  get isFollowing(): boolean {
    return this.followTargetX !== null;
  }

  /** Update follow mode lerp. Call once per frame. */
  update(deltaSec: number) {
    if (this.followTargetX === null || this.followTargetY === null) return;

    // Target offset: center the follow target in viewport
    const targetOffsetX = this.followTargetX + TILE_SIZE / 2 - this.viewportW / (2 * this.zoom);
    const targetOffsetY = this.followTargetY + TILE_SIZE / 2 - this.viewportH / (2 * this.zoom);

    const t = 1 - Math.exp(-FOLLOW_LERP_SPEED * deltaSec);
    this.offsetX += (targetOffsetX - this.offsetX) * t;
    this.offsetY += (targetOffsetY - this.offsetY) * t;

    this.clampBounds();
  }

  /** Convert screen coordinates to world coordinates */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: screenX / this.zoom + this.offsetX,
      y: screenY / this.zoom + this.offsetY,
    };
  }

  /** Convert world coordinates to screen coordinates */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: (worldX - this.offsetX) * this.zoom,
      y: (worldY - this.offsetY) * this.zoom,
    };
  }

  /** Apply camera transform to a canvas context */
  applyTransform(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(this.zoom, 0, 0, this.zoom, -this.offsetX * this.zoom, -this.offsetY * this.zoom);
  }

  /** Reset transform to identity */
  resetTransform(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Clamp offset so the viewport cannot scroll outside the map */
  private clampBounds() {
    const worldViewW = this.viewportW / this.zoom;
    const worldViewH = this.viewportH / this.zoom;

    const maxOffsetX = CANVAS_WIDTH - worldViewW;
    const maxOffsetY = CANVAS_HEIGHT - worldViewH;

    // If viewport is larger than map, center it
    if (maxOffsetX <= 0) {
      this.offsetX = maxOffsetX / 2;
    } else {
      this.offsetX = Math.max(0, Math.min(maxOffsetX, this.offsetX));
    }

    if (maxOffsetY <= 0) {
      this.offsetY = maxOffsetY / 2;
    } else {
      this.offsetY = Math.max(0, Math.min(maxOffsetY, this.offsetY));
    }
  }
}
