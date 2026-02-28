'use client';

import { useEffect, useState, useCallback } from 'react';
import type { KomodoConfig, AgentModel, Project } from '@/lib/config-types';
import { DEFAULT_CONFIG } from '@/lib/config-types';

const MODEL_OPTIONS: { value: AgentModel; label: string }[] = [
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
];

const AGENT_LABELS: Record<string, { name: string; icon: string }> = {
  planner: { name: 'Planner', icon: '✎' },
  coder: { name: 'Coder', icon: '⌨' },
  reviewer: { name: 'Reviewer', icon: '⊘' },
};

export default function SettingsPage() {
  const [config, setConfig] = useState<KomodoConfig>(DEFAULT_CONFIG);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [configRes, projectsRes] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/projects'),
      ]);

      const configData: KomodoConfig = await configRes.json();
      setConfig(configData);

      const projectsData = await projectsRes.json();
      if (projectsData.error) {
        setProjectsError(projectsData.error);
      } else {
        setProjects(projectsData.projects ?? []);
      }
    } catch {
      setProjectsError('Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleSave() {
    setSaving(true);
    setSaveStatus('idle');
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (res.ok) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }

  function updateAgentModel(agent: 'planner' | 'coder' | 'reviewer', model: AgentModel) {
    setConfig((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        [agent]: { ...prev.agents[agent], model },
      },
    }));
  }

  function updateAgentMaxTurns(agent: 'planner' | 'coder' | 'reviewer', maxTurns: number) {
    setConfig((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        [agent]: { ...prev.agents[agent], maxTurns },
      },
    }));
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-neutral-500">Loading configuration...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="flex items-center gap-3">
          {saveStatus === 'saved' && (
            <span className="text-sm text-green-400">Saved successfully</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-sm text-red-400">Failed to save</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* Active Project */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-lg font-semibold">Active Project</h2>
        {projectsError ? (
          <p className="text-sm text-neutral-500">{projectsError}</p>
        ) : (
          <div className="max-w-md">
            <label className="mb-1 block text-sm font-medium text-neutral-400">
              Project
            </label>
            <select
              value={config.activeProjectId}
              onChange={(e) => setConfig((prev) => ({ ...prev, activeProjectId: e.target.value }))}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200"
            >
              <option value="">— Select a project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {/* Agent Configuration */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-lg font-semibold">Agent Configuration</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(['planner', 'coder', 'reviewer'] as const).map((agent) => (
            <div
              key={agent}
              className="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4"
            >
              <h3 className="mb-3 text-sm font-semibold text-neutral-200">
                <span className="mr-1.5">{AGENT_LABELS[agent].icon}</span>
                {AGENT_LABELS[agent].name}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-400">
                    Model
                  </label>
                  <select
                    value={config.agents[agent].model}
                    onChange={(e) => updateAgentModel(agent, e.target.value as AgentModel)}
                    className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-200"
                  >
                    {MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-400">
                    Max Turns
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={config.agents[agent].maxTurns}
                    onChange={(e) => updateAgentMaxTurns(agent, parseInt(e.target.value) || 1)}
                    className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-200"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Orchestrator Settings */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-lg font-semibold">Orchestrator</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Max Review Cycles */}
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-400">
              Max Review Cycles
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={config.maxReviewCycles}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  maxReviewCycles: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)),
                }))
              }
              className="w-full max-w-xs rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Number of review iterations before stopping (1-10)
            </p>
          </div>

          {/* Budget Limit */}
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-400">
              Budget Limit (USD)
            </label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={config.budgetLimit}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  budgetLimit: Math.max(0, parseFloat(e.target.value) || 0),
                }))
              }
              className="w-full max-w-xs rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200"
            />
            <p className="mt-1 text-xs text-neutral-500">
              0 = no limit. Maximum spend per task in USD.
            </p>
          </div>

          {/* Continuous Mode */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={config.continuousMode}
                onClick={() =>
                  setConfig((prev) => ({ ...prev, continuousMode: !prev.continuousMode }))
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  config.continuousMode ? 'bg-blue-600' : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    config.continuousMode ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <div>
                <span className="text-sm font-medium text-neutral-200">Continuous Mode</span>
                <p className="text-xs text-neutral-500">
                  Automatically pick up the next task after completing one
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
