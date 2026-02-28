import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { KomodoConfig } from '@/lib/config-types';
import { DEFAULT_CONFIG } from '@/lib/config-types';

const CONFIG_FILE = resolve(process.cwd(), '..', 'komodo.config.json');

export async function GET() {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return NextResponse.json(DEFAULT_CONFIG);
    }

    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const saved = JSON.parse(raw) as Partial<KomodoConfig>;

    // Merge with defaults so new fields are always present
    const config: KomodoConfig = {
      ...DEFAULT_CONFIG,
      ...saved,
      agents: {
        planner: { ...DEFAULT_CONFIG.agents.planner, ...saved.agents?.planner },
        coder: { ...DEFAULT_CONFIG.agents.coder, ...saved.agents?.coder },
        reviewer: { ...DEFAULT_CONFIG.agents.reviewer, ...saved.agents?.reviewer },
      },
    };

    return NextResponse.json(config);
  } catch {
    return NextResponse.json(DEFAULT_CONFIG);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as KomodoConfig;

    // Validate
    if (body.maxReviewCycles < 1 || body.maxReviewCycles > 10) {
      return NextResponse.json(
        { error: 'maxReviewCycles must be between 1 and 10' },
        { status: 400 },
      );
    }

    if (body.budgetLimit < 0) {
      return NextResponse.json({ error: 'budgetLimit must be >= 0' }, { status: 400 });
    }

    const validModels = ['sonnet', 'opus', 'haiku'];
    for (const agent of ['planner', 'coder', 'reviewer'] as const) {
      if (!validModels.includes(body.agents[agent].model)) {
        return NextResponse.json(
          { error: `Invalid model for ${agent}: ${body.agents[agent].model}` },
          { status: 400 },
        );
      }
      if (body.agents[agent].maxTurns < 1 || body.agents[agent].maxTurns > 100) {
        return NextResponse.json(
          { error: `maxTurns for ${agent} must be between 1 and 100` },
          { status: 400 },
        );
      }
    }

    writeFileSync(CONFIG_FILE, JSON.stringify(body, null, 2), 'utf-8');

    return NextResponse.json({ saved: true, config: body });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
