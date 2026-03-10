'use client';

import type { MultiProjectState } from '@/lib/types';

interface ProjectSelectorProps {
  multiProject: MultiProjectState;
  selectedProject: string | null;
  onSelectProject: (projectId: string | null) => void;
}

export function ProjectSelector({ multiProject, selectedProject, onSelectProject }: ProjectSelectorProps) {
  const { projects, activeProject, strategy } = multiProject;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-neutral-400">Projects</h2>
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-500">
          {strategy}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* All Projects button */}
        <button
          onClick={() => onSelectProject(null)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            selectedProject === null
              ? 'bg-violet-600 text-white'
              : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'
          }`}
        >
          All Projects
        </button>

        {/* Individual project buttons */}
        {projects.map((projectId) => {
          const isActive = activeProject === projectId;
          const isSelected = selectedProject === projectId;

          return (
            <button
              key={projectId}
              onClick={() => onSelectProject(projectId)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isSelected
                  ? 'bg-violet-600 text-white'
                  : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'
              }`}
            >
              {isActive && (
                <span className="inline-block h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              )}
              {projectId}
            </button>
          );
        })}
      </div>
    </section>
  );
}
