import { NextResponse } from 'next/server';
import { writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PATTERNS_FILE = resolve(process.cwd(), '..', 'memory', 'patterns.json');

export async function DELETE() {
  try {
    if (!existsSync(PATTERNS_FILE)) {
      return NextResponse.json({ cleared: true, message: 'No patterns file found' });
    }

    const emptyStore = { patterns: [], reviewOutcomes: [] };
    writeFileSync(PATTERNS_FILE, JSON.stringify(emptyStore, null, 2), 'utf-8');

    return NextResponse.json({ cleared: true, message: 'Memory cleared successfully' });
  } catch (err) {
    return NextResponse.json(
      { cleared: false, message: `Failed to clear memory: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
