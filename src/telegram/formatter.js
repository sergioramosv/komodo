/**
 * Formatea mensajes de notificación para Telegram usando MarkdownV2.
 *
 * Referencia MarkdownV2:
 * - Escapar caracteres especiales: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * - Negrita: *texto*
 * - Cursiva: _texto_
 * - Monospace: `texto`
 * - Link: [texto](url)
 */

const SPECIAL_CHARS = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

/**
 * Escapa caracteres especiales de MarkdownV2.
 * @param {string} text
 * @returns {string}
 */
export function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(SPECIAL_CHARS, '\\$1');
}

/**
 * Escapa una URL para usarla dentro de links MarkdownV2 [text](url).
 * Solo escapa ')' y '\' — los únicos caracteres que rompen la sintaxis de link.
 * @param {string} url
 * @returns {string}
 */
export function escapeUrl(url) {
  if (!url) return '';
  return String(url).replace(/([)\\])/g, '\\$1');
}

/**
 * Notificación: Planner eligió tarea.
 */
export function formatTaskStarted(metadata) {
  const title = escapeMarkdown(metadata.title || 'Sin título');
  const branch = escapeMarkdown(metadata.branchName || '?');
  const taskId = escapeMarkdown(metadata.taskId || '?');

  const lines = [
    `\u{1F4CB} *Planner eligió tarea*`,
    ``,
    `*Tarea:* ${title}`,
    `*ID:* \`${taskId}\``,
    `*Branch:* \`${branch}\``,
  ];

  if (metadata.priority != null) {
    lines.push(`*Prioridad:* ${escapeMarkdown(String(metadata.priority))}`);
  }

  return lines.join('\n');
}

/**
 * Notificación: Coder creó PR.
 */
export function formatPRCreated(metadata) {
  const pr = escapeMarkdown(String(metadata.prNumber || '?'));
  const repo = metadata.repo || '';
  const branch = escapeMarkdown(metadata.branchName || '?');
  const prUrl = repo ? `https://github.com/${repo}/pull/${metadata.prNumber}` : '';

  const lines = [
    `\u{1F4E6} *Coder creó PR*`,
    ``,
    `*PR:* [\\#${pr}](${escapeUrl(prUrl)})`,
    `*Branch:* \`${branch}\``,
  ];

  if (metadata.filesChanged && metadata.filesChanged.length > 0) {
    lines.push(`*Archivos:* ${escapeMarkdown(String(metadata.filesChanged.length))}`);
  }

  if (metadata.summary) {
    lines.push(`*Resumen:* ${escapeMarkdown(metadata.summary)}`);
  }

  return lines.join('\n');
}

/**
 * Notificación: Reviewer terminó ciclo de review.
 */
export function formatReviewCycleEnd(metadata) {
  const verdict = metadata.verdict || '?';
  const cycle = metadata.cycle || '?';
  const maxCycles = metadata.maxCycles || '?';
  const pr = metadata.prNumber || '?';

  const emoji = verdict === 'APPROVED' ? '\u2705' : '\u{1F50D}';
  const verdictText = verdict === 'APPROVED' ? 'APPROVED' : 'REQUEST\\_CHANGES';

  const lines = [
    `${emoji} *Review ciclo ${escapeMarkdown(String(cycle))}/${escapeMarkdown(String(maxCycles))}*`,
    ``,
    `*PR:* \\#${escapeMarkdown(String(pr))}`,
    `*Veredicto:* \`${verdictText}\``,
  ];

  if (metadata.score != null) {
    lines.push(`*Score:* ${escapeMarkdown(String(metadata.score))}`);
  }

  if (metadata.issuesCount != null) {
    lines.push(`*Issues:* ${escapeMarkdown(String(metadata.issuesCount))}`);
  }

  return lines.join('\n');
}

/**
 * Notificación: Coder terminó fixes.
 */
export function formatFixDone(metadata) {
  const cycle = metadata.cycle || '?';

  const lines = [
    `\u{1F527} *Coder aplicó fixes*`,
    ``,
    `*Ciclo:* ${escapeMarkdown(String(cycle))}`,
  ];

  if (metadata.summary) {
    lines.push(`*Resumen:* ${escapeMarkdown(metadata.summary)}`);
  }

  return lines.join('\n');
}

/**
 * Notificación: PR mergeada (tarea completada).
 */
export function formatPRMerged(metadata) {
  const pr = escapeMarkdown(String(metadata.prNumber || '?'));
  const repo = metadata.repo || '';
  const prUrl = repo ? `https://github.com/${repo}/pull/${metadata.prNumber}` : '';

  const lines = [
    `\u{1F389} *PR mergeada*`,
    ``,
    `*PR:* [\\#${pr}](${escapeUrl(prUrl)})`,
  ];

  if (metadata.taskId) {
    lines.push(`*Tarea:* \`${escapeMarkdown(metadata.taskId)}\``);
  }

  return lines.join('\n');
}

/**
 * Notificación: Tarea completada (resumen final).
 */
export function formatTaskCompleted(metadata) {
  const title = escapeMarkdown(metadata.title || 'Sin título');
  const pr = escapeMarkdown(String(metadata.prNumber || '?'));
  const cycles = escapeMarkdown(String(metadata.reviewCycles || 0));
  const duration = metadata.totalDuration
    ? escapeMarkdown(`${metadata.totalDuration.toFixed(1)}s`)
    : '?';
  const merged = metadata.merged ? '\u2705 Sí' : '\u23F3 Manual';

  return [
    `\u{1F3C1} *Tarea completada*`,
    ``,
    `*Tarea:* ${title}`,
    `*PR:* \\#${pr}`,
    `*Review cycles:* ${cycles}`,
    `*Merged:* ${merged}`,
    `*Duración:* ${duration}`,
  ].join('\n');
}

/**
 * Notificación: Error o rollback.
 */
export function formatError(metadata) {
  const taskTitle = escapeMarkdown(metadata.title || metadata.taskId || '?');
  const error = escapeMarkdown(metadata.error || 'Error desconocido');

  const lines = [
    `\u{1F6A8} *Error / Rollback*`,
    ``,
    `*Tarea:* ${taskTitle}`,
    `*Error:* ${error}`,
  ];

  if (metadata.prNumber) {
    lines.push(`*PR:* \\#${escapeMarkdown(String(metadata.prNumber))}`);
  }

  return lines.join('\n');
}

/**
 * Notificación: CLI recuperado de rate limit.
 */
export function formatCliRecovered(metadata) {
  const cli = escapeMarkdown(metadata.cli || '?');
  const minutes = escapeMarkdown(String(metadata.downtimeMinutes || 0));

  const lines = [
    `\u{1F7E2} *CLI recuperado*`,
    ``,
    `*CLI:* \`${cli}\``,
    `*Cooldown:* ${minutes} min`,
  ];

  if (metadata.taskTitle) {
    lines.push(`*Reanudando:* ${escapeMarkdown(metadata.taskTitle)}`);
  }

  return lines.join('\n');
}

/**
 * Notificación: Todos los CLIs en rate limit.
 */
export function formatAllClisRateLimited(metadata) {
  const clis = (metadata.clis || []).map(c => escapeMarkdown(c)).join(', ');

  return [
    `\u{1F534} *Todos los CLIs en cooldown*`,
    ``,
    `*CLIs:* ${clis || '?'}`,
    `_Komodo en espera\\. Se reanudará automáticamente al recuperarse un CLI\\._`,
  ].join('\n');
}

// --- CI Monitor event formatters ---

/**
 * Notificación: CI passed after merge.
 */
export function formatCiPassed(metadata) {
  const pr = escapeMarkdown(String(metadata.prNumber || '?'));
  const runId = escapeMarkdown(String(metadata.runId || '?'));

  return [
    `\u2705 *CI passed*`,
    ``,
    `*PR:* \\#${pr}`,
    `*Run:* \`${runId}\``,
  ].join('\n');
}

/**
 * Notificación: CI failed after merge.
 */
export function formatCiFailed(metadata) {
  const pr = escapeMarkdown(String(metadata.prNumber || '?'));
  const runId = escapeMarkdown(String(metadata.runId || '?'));
  const errorSnippet = escapeMarkdown((metadata.errorLog || '').slice(0, 500));

  const lines = [
    `\u{1F6A8} *CI failed after merge*`,
    ``,
    `*PR:* \\#${pr}`,
    `*Run:* \`${runId}\``,
  ];

  if (errorSnippet) {
    lines.push(`*Error:* ${errorSnippet}`);
  }

  return lines.join('\n');
}

// --- Daemon event formatters ---

/**
 * Notificación: Daemon started.
 */
export function formatDaemonStarted(metadata) {
  const pollInterval = escapeMarkdown(String(metadata.pollInterval || 60));
  const maxTasks = metadata.maxTasks === 0 ? 'ilimitadas' : escapeMarkdown(String(metadata.maxTasks));

  return [
    `\u{1F916} *Daemon iniciado*`,
    ``,
    `*Poll interval:* ${pollInterval}s`,
    `*Max tareas:* ${maxTasks}`,
  ].join('\n');
}

/**
 * Notificación: Daemon idle.
 */
export function formatDaemonIdle(metadata) {
  const nextPoll = escapeMarkdown(String(metadata.nextPollIn || 60));
  const completed = escapeMarkdown(String(metadata.tasksCompleted || 0));

  return [
    `\u{1F4A4} *Daemon idle*`,
    ``,
    `*Tareas completadas:* ${completed}`,
    `*Siguiente poll:* ${nextPoll}s`,
  ].join('\n');
}

/**
 * Notificación: Daemon detected a new task.
 */
export function formatDaemonTaskDetected(metadata) {
  const completed = escapeMarkdown(String(metadata.tasksCompleted || 0));

  return [
    `\u{1F514} *Tarea detectada en backlog*`,
    ``,
    `*Tareas completadas antes:* ${completed}`,
    `_Ejecutando tarea\\.\\.\\._`,
  ].join('\n');
}

/**
 * Notificación: Daemon stopped.
 */
export function formatDaemonStopped(metadata) {
  const completed = escapeMarkdown(String(metadata.tasksCompleted || 0));
  const failed = escapeMarkdown(String(metadata.tasksFailed || 0));

  return [
    `\u{1F6D1} *Daemon detenido*`,
    ``,
    `*Tareas completadas:* ${completed}`,
    `*Tareas fallidas:* ${failed}`,
  ].join('\n');
}

// --- Release event formatters ---

/**
 * Notificacion: GitHub Release created after sprint completion.
 */
export function formatReleaseCreated(metadata) {
  const tag = escapeMarkdown(metadata.tag || '?');
  const sprintName = escapeMarkdown(metadata.sprintName || '?');
  const taskCount = escapeMarkdown(String(metadata.taskCount || 0));
  const repo = metadata.repo || '';
  const releaseUrl = metadata.releaseUrl || '';

  const lines = [
    `\u{1F680} *GitHub Release creado*`,
    ``,
    `*Tag:* \`${tag}\``,
    `*Sprint:* ${sprintName}`,
    `*Tareas:* ${taskCount}`,
  ];

  if (releaseUrl) {
    lines.push(`*Release:* [Ver release](${escapeUrl(releaseUrl)})`);
  }

  return lines.join('\n');
}

/**
 * Notificacion: Release blocked by open bugs.
 */
export function formatReleaseGateBlocked(metadata) {
  const bugCount = escapeMarkdown(String((metadata.blockingBugs || []).length));
  const overridden = metadata.overridden ? ' \\(OVERRIDE\\)' : '';

  const lines = [
    `\u{1F6AB} *Release bloqueado por bugs*${overridden}`,
    ``,
    `*Bugs bloqueantes:* ${bugCount}`,
  ];

  for (const bug of (metadata.blockingBugs || [])) {
    const severity = escapeMarkdown(bug.severity || '?');
    const title = escapeMarkdown(bug.title || '?');
    const status = escapeMarkdown(bug.status || '?');
    lines.push(`  \\- \\[${severity}\\] ${title} \\(${status}\\)`);
  }

  if (metadata.overridden) {
    lines.push(``);
    lines.push(`_Release forzado con RELEASE\\_IGNORE\\_BUGS\\=true_`);
  } else {
    lines.push(``);
    lines.push(`_Resuelve los bugs para desbloquear el release\\._`);
  }

  return lines.join('\n');
}

// --- Query command formatters ---

/**
 * Formats elapsed milliseconds as a human-readable string (e.g. "5m 23s").
 * @param {number} ms
 * @returns {string}
 */
function formatElapsed(ms) {
  if (!ms || ms < 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

const PHASE_LABELS = {
  idle: 'Inactivo',
  planning: 'Planificando',
  coding: 'Programando',
  reviewing: 'Revisando',
  merging: 'Mergeando',
};

const STATE_EMOJIS = {
  running: '\u{1F7E2}',
  stopped: '\u{1F534}',
  paused: '\u{1F7E1}',
};

/**
 * Formats /status response.
 * @param {Object} status - From data.getStatus()
 * @returns {string} MarkdownV2 message
 */
export function formatStatus(status) {
  const stateEmoji = STATE_EMOJIS[status.executionState] || '\u2753';
  const stateLabel = escapeMarkdown(status.executionState.toUpperCase());
  const phaseLabel = escapeMarkdown(PHASE_LABELS[status.phase] || status.phase);

  const lines = [
    `${stateEmoji} *Estado de Komodo*`,
    ``,
    `*Estado:* ${stateLabel}`,
    `*Fase:* ${phaseLabel}`,
  ];

  if (status.activeAgent) {
    lines.push(`*Agente activo:* ${escapeMarkdown(status.activeAgent.name)}`);
  }

  if (status.currentTask) {
    lines.push(`*Tarea:* ${escapeMarkdown(status.currentTask.title || status.currentTask.id)}`);
    if (status.currentTask.devPoints) {
      lines.push(`*Dev points:* ${escapeMarkdown(String(status.currentTask.devPoints))}`);
    }
  }

  if (status.currentPR) {
    lines.push(`*PR:* \\#${escapeMarkdown(String(status.currentPR))}`);
  }

  if (status.reviewCycle > 0) {
    lines.push(`*Review cycle:* ${escapeMarkdown(String(status.reviewCycle))}`);
  }

  if (status.elapsedMs) {
    lines.push(`*Tiempo:* ${escapeMarkdown(formatElapsed(status.elapsedMs))}`);
  }

  if (status.totalTasks > 0) {
    lines.push(`*Progreso:* ${escapeMarkdown(String(status.tasksCompleted))}/${escapeMarkdown(String(status.totalTasks))} tareas`);
  }

  return lines.join('\n');
}

/**
 * Formats /tasks response.
 * @param {Array} tasks - From data.getTasks()
 * @returns {string} MarkdownV2 message
 */
export function formatTaskList(tasks) {
  if (!tasks || tasks.length === 0) {
    return '\u{1F4CB} *Tareas to\\-do*\n\nNo hay tareas pendientes\\.';
  }

  const lines = [
    `\u{1F4CB} *Tareas to\\-do* \\(${escapeMarkdown(String(tasks.length))}\\)`,
    ``,
  ];

  const maxItems = 15;
  const shown = tasks.slice(0, maxItems);

  for (let i = 0; i < shown.length; i++) {
    const t = shown[i];
    const num = escapeMarkdown(String(i + 1));
    const pts = escapeMarkdown(String(t.devPoints));
    const title = escapeMarkdown(t.title);
    lines.push(`${num}\\. \\[${pts} pts\\] ${title}`);
  }

  if (tasks.length > maxItems) {
    lines.push(`\n_\\.\\.\\.y ${escapeMarkdown(String(tasks.length - maxItems))} más_`);
  }

  return lines.join('\n');
}

/**
 * Formats /backlog response.
 * @param {Object} backlog - From data.getBacklog()
 * @returns {string} MarkdownV2 message
 */
export function formatBacklog(backlog) {
  if (backlog.error) {
    return `\u{1F6A8} *Error:* ${escapeMarkdown(backlog.error)}`;
  }

  const lines = [
    `\u{1F4CA} *Resumen del backlog*`,
    ``,
    `*Tareas pendientes:* ${escapeMarkdown(String(backlog.pendingCount))}`,
    `*En progreso:* ${escapeMarkdown(String(backlog.inProgressCount))}`,
    `*Completadas:* ${escapeMarkdown(String(backlog.doneCount))}`,
    `*Total:* ${escapeMarkdown(String(backlog.totalTasks))}`,
    `*Dev points pendientes:* ${escapeMarkdown(String(backlog.totalDevPoints))}`,
  ];

  if (backlog.activeSprint) {
    const sp = backlog.activeSprint;
    const progress = sp.totalTasks > 0
      ? Math.round((sp.completedTasks / sp.totalTasks) * 100)
      : 0;
    const bar = buildProgressBar(progress);

    lines.push(``);
    lines.push(`*Sprint activo:* ${escapeMarkdown(sp.name)}`);
    lines.push(`*Periodo:* ${escapeMarkdown(sp.startDate)} \\- ${escapeMarkdown(sp.endDate)}`);
    lines.push(`*Progreso:* ${bar} ${escapeMarkdown(String(progress))}% \\(${escapeMarkdown(String(sp.completedTasks))}/${escapeMarkdown(String(sp.totalTasks))}\\)`);
  } else {
    lines.push(``);
    lines.push(`_No hay sprint activo_`);
  }

  return lines.join('\n');
}

/**
 * Builds a text progress bar for Telegram.
 * @param {number} percent - 0 to 100
 * @returns {string} Escaped progress bar
 */
function buildProgressBar(percent) {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return escapeMarkdown('\u2588'.repeat(filled) + '\u2591'.repeat(empty));
}

// --- Budget event formatters ---

/**
 * Notificación: Budget warning (80% reached).
 */
export function formatBudgetWarning(metadata) {
  const dailySpent = escapeMarkdown((metadata.dailySpent || 0).toFixed(2));
  const dailyBudget = metadata.dailyBudget > 0 ? escapeMarkdown(String(metadata.dailyBudget)) : null;
  const weeklySpent = escapeMarkdown((metadata.weeklySpent || 0).toFixed(2));
  const weeklyBudget = metadata.weeklyBudget > 0 ? escapeMarkdown(String(metadata.weeklyBudget)) : null;

  const lines = [
    `\u26A0\uFE0F *Alerta de budget \\(80%\\)*`,
    ``,
  ];

  if (dailyBudget) {
    const pct = metadata.percentDaily != null ? ` \\(${escapeMarkdown(String(metadata.percentDaily))}%\\)` : '';
    lines.push(`*Diario:* $${dailySpent} / $${dailyBudget}${pct}`);
  }

  if (weeklyBudget) {
    const pct = metadata.percentWeekly != null ? ` \\(${escapeMarkdown(String(metadata.percentWeekly))}%\\)` : '';
    lines.push(`*Semanal:* $${weeklySpent} / $${weeklyBudget}${pct}`);
  }

  lines.push(`_El daemon se pausará automáticamente al alcanzar el 100%\\._`);

  return lines.join('\n');
}

/**
 * Notificación: Budget exceeded — daemon auto-paused.
 */
export function formatBudgetExceeded(metadata) {
  const dailySpent = escapeMarkdown((metadata.dailySpent || 0).toFixed(2));
  const dailyBudget = metadata.dailyBudget > 0 ? escapeMarkdown(String(metadata.dailyBudget)) : null;
  const weeklySpent = escapeMarkdown((metadata.weeklySpent || 0).toFixed(2));
  const weeklyBudget = metadata.weeklyBudget > 0 ? escapeMarkdown(String(metadata.weeklyBudget)) : null;

  const lines = [
    `\u{1F6D1} *Budget superado — daemon pausado*`,
    ``,
  ];

  if (dailyBudget) {
    lines.push(`*Diario:* $${dailySpent} / $${dailyBudget}`);
  }

  if (weeklyBudget) {
    lines.push(`*Semanal:* $${weeklySpent} / $${weeklyBudget}`);
  }

  lines.push(`_El daemon no ejecutará nuevas tareas hasta que se resetee el período\\._`);

  return lines.join('\n');
}

// --- Run command formatters ---

/**
 * Formats the immediate feedback when /run is triggered.
 * @param {Object} options
 * @param {number} options.tasks - Number of tasks (0 = all)
 * @returns {string} MarkdownV2 message
 */
export function formatRunStarted({ tasks }) {
  const mode = tasks === 0
    ? 'todas las tareas del backlog'
    : `${escapeMarkdown(String(tasks))} tarea${tasks > 1 ? 's' : ''}`;

  return [
    `\u{1F680} *Ejecuci\u00f3n iniciada*`,
    ``,
    `*Modo:* ${mode}`,
    `_Recibir\u00e1s notificaciones de progreso\\.\\.\\._`,
  ].join('\n');
}

/**
 * Formats the summary after execution completes.
 * @param {Object} result - From orchestrator.run()
 * @param {number} result.tasksCompleted
 * @param {number} result.tasksFailed
 * @param {Array} result.results
 * @returns {string} MarkdownV2 message
 */
export function formatRunSummary(result) {
  const completed = escapeMarkdown(String(result.tasksCompleted));
  const failed = escapeMarkdown(String(result.tasksFailed));

  const lines = [
    `\u{1F3C1} *Ejecuci\u00f3n finalizada*`,
    ``,
    `*Completadas:* ${completed}`,
    `*Fallidas:* ${failed}`,
  ];

  // Add details per task result
  for (const r of result.results) {
    if (!r.taskId) continue;

    const emoji = r.success ? '\u2705' : '\u274C';
    const title = escapeMarkdown(r.taskTitle || r.taskId);
    const detail = [];

    if (r.prNumber) detail.push(`PR \\#${escapeMarkdown(String(r.prNumber))}`);
    if (r.reviewCycles) detail.push(`${escapeMarkdown(String(r.reviewCycles))} review cycles`);
    if (r.merged) detail.push('merged');

    const suffix = detail.length > 0 ? ` \\(${detail.join(', ')}\\)` : '';
    lines.push(`${emoji} ${title}${suffix}`);
  }

  return lines.join('\n');
}

/**
 * Formats the dry-run result.
 * @param {Object} result - From orchestrator.run() with dryRun=true
 * @returns {string} MarkdownV2 message
 */
export function formatDryRunResult(result) {
  if (!result.results || result.results.length === 0) {
    return `\u{1F50D} *Dry\\-run*\n\nNo se pudo obtener resultado\\.`;
  }

  const dryResult = result.results[0];

  if (!dryResult.task) {
    return `\u{1F50D} *Dry\\-run*\n\nNo hay tareas pendientes en el backlog\\.`;
  }

  const task = dryResult.task;
  const title = escapeMarkdown(task.title || 'Sin t\u00edtulo');
  const taskId = escapeMarkdown(task.taskId || '?');
  const branch = escapeMarkdown(task.branchName || '?');
  const dev = escapeMarkdown(String(task.devPoints || '?'));
  const biz = escapeMarkdown(String(task.bizPoints || '?'));

  return [
    `\u{1F50D} *Dry\\-run*`,
    ``,
    `*Siguiente tarea:* ${title}`,
    `*ID:* \`${taskId}\``,
    `*Branch:* \`${branch}\``,
    `*Puntos:* biz\\=${biz} dev\\=${dev}`,
  ].join('\n');
}

/**
 * Formats the /stop confirmation.
 * @returns {string} MarkdownV2 message
 */
export function formatStopConfirmed() {
  return [
    `\u{1F6D1} *Stop solicitado*`,
    ``,
    `_La ejecuci\u00f3n se detendr\u00e1 al terminar la tarea actual\\._`,
  ].join('\n');
}

/**
 * Formats the message when /run is called but execution is already running.
 * @returns {string} MarkdownV2 message
 */
export function formatAlreadyRunning() {
  return [
    `\u26A0\uFE0F *Ya hay una ejecuci\u00f3n en curso*`,
    ``,
    `Usa /stop para detenerla o /status para ver el progreso\\.`,
  ].join('\n');
}

/**
 * Formats the message when /stop is called but nothing is running.
 * @returns {string} MarkdownV2 message
 */
export function formatNothingRunning() {
  return `\u2139\uFE0F No hay ninguna ejecuci\u00f3n en curso\\.`;
}

// --- Anomaly alert formatter ---

const ANOMALY_EMOJIS = {
  'token-spike': '\u26A0\uFE0F',
  'review-regression': '\u{1F4C9}',
  'model-degradation': '\u{1F916}',
};

/**
 * Notificación: Anomalía detectada por el sistema de alerting.
 * @param {Object} metadata - { rule, data, suggestion, projectId }
 * @returns {string} MarkdownV2 message
 */
export function formatAnomalyAlert(metadata) {
  const rule = metadata.rule || 'unknown';
  const emoji = ANOMALY_EMOJIS[rule] || '\u26A0\uFE0F';
  const ruleLabel = escapeMarkdown(rule);
  const suggestion = escapeMarkdown(metadata.suggestion || '');
  const projectId = escapeMarkdown(metadata.projectId || '?');

  const lines = [
    `${emoji} *Anomalía detectada: \`${ruleLabel}\`*`,
    ``,
    `*Proyecto:* \`${projectId}\``,
  ];

  // Rule-specific data lines
  const data = metadata.data || {};
  if (rule === 'token-spike') {
    lines.push(`*Tokens usados:* ${escapeMarkdown(String(data.totalTokensUsed ?? '?'))}`);
    lines.push(`*Tokens esperados:* ${escapeMarkdown(String(data.expectedAvg ?? '?'))}`);
    lines.push(`*Ratio:* ${escapeMarkdown(String(data.ratio ?? '?'))}x`);
    if (data.taskId) lines.push(`*Tarea:* \`${escapeMarkdown(data.taskId)}\``);
  } else if (rule === 'review-regression') {
    const scores = (data.recentScores || []).map(s => escapeMarkdown(String(s))).join(', ');
    lines.push(`*Últimos ${escapeMarkdown(String((data.recentScores || []).length))} scores:* ${scores}`);
    lines.push(`*Promedio:* ${escapeMarkdown(String(data.avgScore ?? '?'))}`);
  } else if (rule === 'model-degradation') {
    lines.push(`*Modelo:* \`${escapeMarkdown(data.model ?? '?')}\``);
    lines.push(`*Fail rate:* ${escapeMarkdown(String(data.failRatePercent ?? '?'))}%`);
    lines.push(`*Fallos:* ${escapeMarkdown(String(data.failCount ?? '?'))}/${escapeMarkdown(String(data.taskCount ?? '?'))}`);
  }

  if (suggestion) {
    lines.push(``);
    lines.push(`_${suggestion}_`);
  }

  return lines.join('\n');
}

// --- Weekly digest formatter ---

const TREND_EMOJIS = {
  up: '\u{1F4C8}',
  down: '\u{1F4C9}',
  stable: '\u27A1\uFE0F',
};

/**
 * Formats a date range as "DD Mon – DD Mon" for readability.
 * @param {string} startIso
 * @param {string} endIso
 * @returns {string} escaped MarkdownV2 string
 */
function formatDateRange(startIso, endIso) {
  const opts = { day: 'numeric', month: 'short' };
  const start = new Date(startIso).toLocaleDateString('es-ES', opts);
  const end = new Date(endIso).toLocaleDateString('es-ES', opts);
  return escapeMarkdown(`${start} – ${end}`);
}

/**
 * Formats the weekly metrics digest for Telegram.
 *
 * Sections: summary, completed tasks, PRs, bugs, costs, velocity.
 * Uses emojis for trends: 📈 up, 📉 down, ➡️ stable.
 * Highlights top 3 tasks by bizPoints.
 * Shows ⚠️ warning for open critical bugs.
 *
 * @param {import('../metrics/weekly-metrics.js').WeeklyMetrics} metrics
 * @returns {string} MarkdownV2 formatted message
 */
export function formatWeeklyDigest(metrics) {
  const trendEmoji = TREND_EMOJIS[metrics.velocity.trend] || TREND_EMOJIS.stable;
  const dateRange = formatDateRange(metrics.weekStart, metrics.weekEnd);

  const lines = [
    `\u{1F4CA} *Resumen semanal* \\(${dateRange}\\)`,
    ``,
  ];

  // --- Summary ---
  lines.push(`\u{1F4CB} *Resumen*`);
  lines.push(`  \u2022 *Tareas completadas:* ${escapeMarkdown(String(metrics.tasksCompleted))}`);
  lines.push(`  \u2022 *PRs mergeados:* ${escapeMarkdown(String(metrics.prsMerged))}`);
  lines.push(`  \u2022 *Bugs encontrados:* ${escapeMarkdown(String(metrics.bugsFound))}`);
  lines.push(`  \u2022 *Bugs resueltos:* ${escapeMarkdown(String(metrics.bugsResolved))}`);
  lines.push(``);

  // --- Top tasks ---
  if (metrics.topTasks && metrics.topTasks.length > 0) {
    lines.push(`\u{1F3C6} *Top tareas completadas*`);
    for (let i = 0; i < metrics.topTasks.length; i++) {
      const t = metrics.topTasks[i];
      const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : '\u{1F949}';
      const title = escapeMarkdown(t.title || 'Sin título');
      const biz = escapeMarkdown(String(t.bizPoints || 0));
      lines.push(`  ${medal} ${title} \\(${biz} bizPts\\)`);
    }
    lines.push(``);
  }

  // --- Critical bugs warning ---
  if (metrics.criticalBugsOpen && metrics.criticalBugsOpen.length > 0) {
    lines.push(`\u26A0\uFE0F *Bugs critical abiertos \\(${escapeMarkdown(String(metrics.criticalBugsOpen.length))}\\)*`);
    for (const bug of metrics.criticalBugsOpen) {
      const title = escapeMarkdown(bug.title || 'Sin título');
      lines.push(`  \u{1F534} ${title}`);
    }
    lines.push(``);
  }

  // --- Costs ---
  lines.push(`\u{1F4B0} *Costes*`);
  lines.push(`  \u2022 *Total semana:* $${escapeMarkdown(String(metrics.totalCost))}`);
  lines.push(``);

  // --- Velocity ---
  const currentPts = escapeMarkdown(String(metrics.velocity.currentWeekDevPoints));
  const prevPts = escapeMarkdown(String(metrics.velocity.previousWeekDevPoints));
  const changePct = escapeMarkdown(String(Math.abs(metrics.velocity.changePercent)));
  const sign = metrics.velocity.changePercent >= 0 ? '\\+' : '\\-';

  lines.push(`${trendEmoji} *Velocity*`);
  lines.push(`  \u2022 *Esta semana:* ${currentPts} devPts`);
  lines.push(`  \u2022 *Semana anterior:* ${prevPts} devPts`);
  lines.push(`  \u2022 *Cambio:* ${sign}${changePct}%`);

  return lines.join('\n');
}
