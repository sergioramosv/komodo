import { NextResponse } from 'next/server';

/**
 * Parses a time string "HH:MM" into { hours, minutes }.
 */
function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number);
  return { hours: h, minutes: m };
}

function toMinutes(time: { hours: number; minutes: number }): number {
  return time.hours * 60 + time.minutes;
}

interface ScheduleWindow {
  start: { hours: number; minutes: number };
  end: { hours: number; minutes: number };
}

function parseScheduleWindows(scheduleStr: string): ScheduleWindow[] {
  if (!scheduleStr || !scheduleStr.trim()) return [];
  return scheduleStr.split(',').map(w => {
    const [startStr, endStr] = w.trim().split('-');
    return { start: parseTime(startStr), end: parseTime(endStr) };
  });
}

function isTimeInWindow(
  currentTime: { hours: number; minutes: number },
  window: ScheduleWindow,
): boolean {
  const now = toMinutes(currentTime);
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);
  if (start <= end) return now >= start && now < end;
  return now >= start || now < end;
}

function getCurrentTime(timezone?: string): { hours: number; minutes: number } {
  const now = new Date();
  if (!timezone) return { hours: now.getHours(), minutes: now.getMinutes() };
  const formatted = now.toLocaleTimeString('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [h, m] = formatted.split(':').map(Number);
  return { hours: h, minutes: m };
}

function getNextWindow(
  windows: ScheduleWindow[],
  timezone?: string,
): { minutesUntil: number; nextWindowStart: string } | null {
  if (windows.length === 0) return null;
  const currentTime = getCurrentTime(timezone);
  const nowMinutes = toMinutes(currentTime);
  const DAY = 24 * 60;
  let minWait = Infinity;
  let nextStart: { hours: number; minutes: number } | null = null;

  for (const w of windows) {
    const startMin = toMinutes(w.start);
    let wait = startMin - nowMinutes;
    if (wait <= 0) wait += DAY;
    if (wait < minWait) {
      minWait = wait;
      nextStart = w.start;
    }
  }

  if (!nextStart) return null;
  const startStr = `${String(nextStart.hours).padStart(2, '0')}:${String(nextStart.minutes).padStart(2, '0')}`;
  return { minutesUntil: minWait, nextWindowStart: startStr };
}

/**
 * GET /api/schedule
 *
 * Returns the current schedule configuration and status.
 * Reads SCHEDULE and SCHEDULE_TIMEZONE from process.env.
 */
export async function GET() {
  const schedule = process.env.SCHEDULE || '';
  const timezone = process.env.SCHEDULE_TIMEZONE || '';

  if (!schedule) {
    return NextResponse.json({
      enabled: false,
      schedule: '',
      timezone: '',
      currentlyInWindow: true,
      nextWindow: null,
      windows: [],
    });
  }

  try {
    const windows = parseScheduleWindows(schedule);
    const currentTime = getCurrentTime(timezone || undefined);
    const inWindow = windows.some(w => isTimeInWindow(currentTime, w));
    const nextWindow = inWindow ? null : getNextWindow(windows, timezone || undefined);

    return NextResponse.json({
      enabled: true,
      schedule,
      timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      currentlyInWindow: inWindow,
      nextWindow,
      windows: windows.map(w => ({
        start: `${String(w.start.hours).padStart(2, '0')}:${String(w.start.minutes).padStart(2, '0')}`,
        end: `${String(w.end.hours).padStart(2, '0')}:${String(w.end.minutes).padStart(2, '0')}`,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid schedule format';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
