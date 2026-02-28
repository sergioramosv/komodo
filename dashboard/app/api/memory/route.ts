import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PATTERNS_FILE = resolve(process.cwd(), '..', 'memory', 'patterns.json');

export async function GET() {
  try {
    if (!existsSync(PATTERNS_FILE)) {
      return NextResponse.json({ patterns: [], reviewOutcomes: [] });
    }

    const raw = readFileSync(PATTERNS_FILE, 'utf-8');
    const data = JSON.parse(raw);

    return NextResponse.json({
      patterns: Array.isArray(data.patterns) ? data.patterns : [],
      reviewOutcomes: Array.isArray(data.reviewOutcomes) ? data.reviewOutcomes : [],
    });
  } catch {
    return NextResponse.json({ patterns: [], reviewOutcomes: [] });
  }
}
