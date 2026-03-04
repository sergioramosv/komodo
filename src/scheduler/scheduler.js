import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const AGENT = 'SCHEDULER';

/**
 * Parses a time string "HH:MM" into { hours, minutes }.
 *
 * @param {string} timeStr - Time in "HH:MM" format
 * @returns {{ hours: number, minutes: number }}
 */
export function parseTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid time format: "${timeStr}". Expected HH:MM (00:00-23:59)`);
  }
  return { hours: h, minutes: m };
}

/**
 * Parses the SCHEDULE env string into an array of time windows.
 * Format: "02:00-06:00,14:00-18:00"
 *
 * Windows that cross midnight (e.g., "22:00-04:00") are supported.
 *
 * @param {string} scheduleStr - Comma-separated time windows
 * @returns {Array<{ start: { hours: number, minutes: number }, end: { hours: number, minutes: number } }>}
 */
export function parseScheduleWindows(scheduleStr) {
  if (!scheduleStr || !scheduleStr.trim()) return [];

  return scheduleStr.split(',').map(window => {
    const trimmed = window.trim();
    const [startStr, endStr] = trimmed.split('-');
    if (!startStr || !endStr) {
      throw new Error(`Invalid window format: "${trimmed}". Expected HH:MM-HH:MM`);
    }
    return {
      start: parseTime(startStr.trim()),
      end: parseTime(endStr.trim()),
    };
  });
}

/**
 * Converts { hours, minutes } into total minutes since midnight.
 *
 * @param {{ hours: number, minutes: number }} time
 * @returns {number}
 */
function toMinutes(time) {
  return time.hours * 60 + time.minutes;
}

/**
 * Gets the current time in the configured timezone.
 *
 * @param {string} [timezone] - IANA timezone (e.g., "Europe/Madrid"). Defaults to system timezone.
 * @returns {{ hours: number, minutes: number }}
 */
export function getCurrentTime(timezone) {
  const now = new Date();
  if (!timezone) {
    return { hours: now.getHours(), minutes: now.getMinutes() };
  }

  const formatted = now.toLocaleTimeString('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return parseTime(formatted);
}

/**
 * Checks if a given time falls within a single window.
 * Handles windows that cross midnight (e.g., 22:00-04:00).
 *
 * @param {{ hours: number, minutes: number }} currentTime
 * @param {{ start: { hours: number, minutes: number }, end: { hours: number, minutes: number } }} window
 * @returns {boolean}
 */
export function isTimeInWindow(currentTime, window) {
  const now = toMinutes(currentTime);
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);

  if (start <= end) {
    // Normal window (e.g., 02:00-06:00)
    return now >= start && now < end;
  }
  // Crosses midnight (e.g., 22:00-04:00)
  return now >= start || now < end;
}

/**
 * Checks if the current time is within any of the configured schedule windows.
 *
 * @param {Array<{ start: { hours: number, minutes: number }, end: { hours: number, minutes: number } }>} windows
 * @param {string} [timezone]
 * @returns {boolean}
 */
export function isInScheduleWindow(windows, timezone) {
  if (!windows || windows.length === 0) return true; // No schedule = 24/7

  const currentTime = getCurrentTime(timezone);
  return windows.some(w => isTimeInWindow(currentTime, w));
}

/**
 * Calculates how many minutes until the next execution window opens.
 *
 * @param {Array<{ start: { hours: number, minutes: number }, end: { hours: number, minutes: number } }>} windows
 * @param {string} [timezone]
 * @returns {{ minutesUntil: number, nextWindowStart: string } | null}
 */
export function getNextWindow(windows, timezone) {
  if (!windows || windows.length === 0) return null;

  const currentTime = getCurrentTime(timezone);
  const nowMinutes = toMinutes(currentTime);
  const DAY = 24 * 60;

  let minWait = Infinity;
  let nextStart = null;

  for (const w of windows) {
    const startMin = toMinutes(w.start);
    // Minutes until this window starts
    let wait = startMin - nowMinutes;
    if (wait <= 0) wait += DAY; // Next day

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
 * Formats minutes into a human-readable string.
 *
 * @param {number} minutes
 * @returns {string}
 */
export function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

/**
 * Main scheduler check: determines if Komodo should execute right now.
 * Uses config.schedule and config.scheduleTimezone.
 *
 * @returns {{ allowed: boolean, nextWindow: { minutesUntil: number, nextWindowStart: string } | null }}
 */
export function checkSchedule() {
  const windows = parseScheduleWindows(config.schedule);

  if (windows.length === 0) {
    return { allowed: true, nextWindow: null };
  }

  const allowed = isInScheduleWindow(windows, config.scheduleTimezone);

  if (allowed) {
    return { allowed: true, nextWindow: null };
  }

  const nextWindow = getNextWindow(windows, config.scheduleTimezone);

  if (nextWindow) {
    logger.info(
      `Outside schedule window. Next window: ${nextWindow.nextWindowStart} (in ${formatMinutes(nextWindow.minutesUntil)})`,
      AGENT,
    );
  }

  return { allowed: false, nextWindow };
}
