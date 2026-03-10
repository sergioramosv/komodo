import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import type { KomodoConfig, CliProvider } from '@/lib/config-types';
import { DEFAULT_CONFIG, CLI_MODELS } from '@/lib/config-types';

const CONFIG_FILE = resolve(process.cwd(), '..', 'komodo.config.json');

const VALID_CLIS: CliProvider[] = ['claude', 'codex', 'gemini'];

function detectInstalledClis(): CliProvider[] {
  const installed: CliProvider[] = [];
  const checkCmd = process.platform === 'win32' ? 'where' : 'which';
  for (const cli of VALID_CLIS) {
    try {
      execSync(`${checkCmd} ${cli}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
      });
      installed.push(cli);
    } catch {
      // CLI not installed or not in PATH
    }
  }
  return installed;
}

export async function GET() {
  try {
    if (!existsSync(CONFIG_FILE)) {
      const availableClis = detectInstalledClis();
      return NextResponse.json({ ...DEFAULT_CONFIG, availableClis });
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

    const availableClis = detectInstalledClis();

    return NextResponse.json({ ...config, availableClis });
  } catch {
    const availableClis = detectInstalledClis();
    return NextResponse.json({ ...DEFAULT_CONFIG, availableClis });
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

    for (const agent of ['planner', 'coder', 'reviewer'] as const) {
      const agentCfg = body.agents[agent];

      // Validate CLI provider
      if (!VALID_CLIS.includes(agentCfg.cli)) {
        return NextResponse.json(
          { error: `Invalid CLI for ${agent}: ${agentCfg.cli}` },
          { status: 400 },
        );
      }

      // Validate model belongs to the selected CLI
      const validModels = CLI_MODELS[agentCfg.cli].map((m) => m.value);
      if (!validModels.includes(agentCfg.model)) {
        return NextResponse.json(
          { error: `Invalid model "${agentCfg.model}" for CLI "${agentCfg.cli}" on ${agent}` },
          { status: 400 },
        );
      }

      if (agentCfg.maxTurns < 1 || agentCfg.maxTurns > 100) {
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
