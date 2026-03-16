import type { AgentStatus } from '@/lib/types';
import { TILE_SIZE } from './office-map';

const BUBBLE_PADDING = 3;
const BUBBLE_MAX_WIDTH = 80;
const BUBBLE_FONT = '6px monospace';
const BUBBLE_LINE_HEIGHT = 8;
const TAIL_SIZE = 4;

/**
 * Draw a speech bubble above a world-space pixel position.
 * The bubble tail points down toward (worldX, worldY).
 */
export function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  worldX: number,
  worldY: number,
  text: string,
): void {
  ctx.save();
  ctx.font = BUBBLE_FONT;

  // Word-wrap text into lines
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > BUBBLE_MAX_WIDTH - BUBBLE_PADDING * 2) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  const textWidth = lines.reduce((max, l) => Math.max(max, ctx.measureText(l).width), 0);
  const bubbleW = Math.ceil(textWidth) + BUBBLE_PADDING * 2;
  const bubbleH = lines.length * BUBBLE_LINE_HEIGHT + BUBBLE_PADDING * 2;

  const centerX = Math.round(worldX + TILE_SIZE / 2);
  const bottomY = Math.round(worldY) - 6; // above agent head
  const bx = centerX - Math.floor(bubbleW / 2);
  const by = bottomY - bubbleH - TAIL_SIZE;

  // Bubble background
  ctx.fillStyle = 'rgba(15, 15, 25, 0.92)';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 0.5;
  roundRect(ctx, bx, by, bubbleW, bubbleH, 3);
  ctx.fill();
  ctx.stroke();

  // Tail triangle
  ctx.beginPath();
  ctx.moveTo(centerX - TAIL_SIZE, by + bubbleH);
  ctx.lineTo(centerX + TAIL_SIZE, by + bubbleH);
  ctx.lineTo(centerX, by + bubbleH + TAIL_SIZE);
  ctx.closePath();
  ctx.fillStyle = 'rgba(15, 15, 25, 0.92)';
  ctx.fill();

  // Text
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'left';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(
      lines[i],
      bx + BUBBLE_PADDING,
      by + BUBBLE_PADDING + (i + 1) * BUBBLE_LINE_HEIGHT - 1,
    );
  }

  ctx.restore();
}

/**
 * Draw a tooltip near the cursor/agent showing name and status.
 */
export function drawTooltip(
  ctx: CanvasRenderingContext2D,
  worldX: number,
  worldY: number,
  name: string,
  status: AgentStatus,
): void {
  ctx.save();
  ctx.font = '7px monospace';

  const statusColor = STATUS_DOT_COLOR[status] ?? '#6b7280';
  const nameW = ctx.measureText(name).width;
  const statusLabel = status.toUpperCase();
  const statusW = ctx.measureText(statusLabel).width;
  const contentW = Math.max(nameW, statusW);
  const tooltipW = Math.ceil(contentW) + 8;
  const tooltipH = 20;

  const tx = Math.round(worldX + TILE_SIZE + 2);
  const ty = Math.round(worldY) - 4;

  ctx.fillStyle = 'rgba(10, 10, 20, 0.95)';
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 0.5;
  roundRect(ctx, tx, ty, tooltipW, tooltipH, 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'left';
  ctx.fillText(name, tx + 4, ty + 8);

  ctx.fillStyle = statusColor;
  ctx.fillText(statusLabel, tx + 4, ty + 17);

  ctx.restore();
}

/** Color for a given status */
const STATUS_DOT_COLOR: Record<AgentStatus, string> = {
  working: '#22c55e',
  walking: '#eab308',
  idle: '#6b7280',
  done: '#22c55e',
};

/** Canvas rounded-rect path helper */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
