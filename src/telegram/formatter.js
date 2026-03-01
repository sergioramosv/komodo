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
