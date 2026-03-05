import { runAgent } from './base-agent.js';
import { getCoderSystemPrompt, getCoderFixSystemPrompt } from '../prompts/coder-system.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { validateAgentResponse } from '../utils/parser.js';
import { getCodebaseContext } from '../intelligence/codebase-indexer.js';
import { getStyleContext } from '../intelligence/style-detector.js';
import { getReviewFeedbackContext } from '../intelligence/review-feedback.js';

/**
 * Build the MCP server list for the Coder agent.
 * Always includes github-mcp; adds chrome-devtools when ENABLE_BROWSER_MCP=true.
 */
function getCoderMcpServers() {
  const servers = ['github-mcp'];
  if (config.enableBrowserMcp) {
    servers.push('chrome-devtools');
  }
  return servers;
}

/**
 * Ejecuta el agente Coder para implementar una tarea.
 * Crea branch, escribe código, commitea, push, abre PR.
 *
 * @param {Object} taskSpec - Especificación de la tarea (viene del Planner)
 * @param {string} taskSpec.taskId
 * @param {string} taskSpec.title
 * @param {Object} taskSpec.userStory - { who, what, why }
 * @param {string[]} taskSpec.acceptanceCriteria
 * @param {string} taskSpec.branchName
 * @param {string} taskSpec.repoUrl
 * @param {string} [cwd] - Directorio del repositorio donde trabajar
 * @param {Object} [options] - Additional options
 * @param {string} [options.model] - Model to use (from model-selector)
 * @returns {Promise<{success: boolean, pr: Object|null, cost: number|null, duration: number, error?: string}>}
 */
export async function implementTask(taskSpec, cwd, { model } = {}) {
  logger.taskHeader(`CODER - Implementando: ${taskSpec.title}`);

  const systemPrompt = getCoderSystemPrompt({ enableBrowserMcp: config.enableBrowserMcp });

  // Build codebase context if enabled
  let codebaseSection = '';
  if (config.codebaseIndexEnabled && cwd) {
    try {
      const { summary } = getCodebaseContext(cwd);
      if (summary) {
        codebaseSection = `\n## Project structure\n${summary}\n`;
      }
    } catch (err) {
      logger.warn(`Could not generate codebase index: ${err.message}`, 'CODER');
    }
  }

  // Build style guide context if enabled
  let styleSection = '';
  if (config.styleDetectorEnabled && cwd) {
    try {
      const { summary } = getStyleContext(cwd);
      if (summary) {
        styleSection = `\n## Code style rules (MANDATORY)\n${summary}\n`;
      }
    } catch (err) {
      logger.warn(`Could not generate style guide: ${err.message}`, 'CODER');
    }
  }

  // Build review feedback context (common mistakes from past reviews)
  let feedbackSection = '';
  try {
    const { summary } = getReviewFeedbackContext();
    if (summary) {
      feedbackSection = `\n## ${summary}\n`;
    }
  } catch (err) {
    logger.warn(`Could not generate review feedback: ${err.message}`, 'CODER');
  }

  const userPrompt = `Implementa la siguiente tarea:

## Tarea
- **ID**: ${taskSpec.taskId}
- **Título**: ${taskSpec.title}

## User Story
- **Como** ${taskSpec.userStory?.who || 'usuario'}
- **Quiero** ${taskSpec.userStory?.what || taskSpec.title}
- **Para** ${taskSpec.userStory?.why || 'mejorar la aplicación'}

## Criterios de aceptación
${(taskSpec.acceptanceCriteria || []).map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Instrucciones
1. Crea la branch "${taskSpec.branchName}" desde main usando create_branch con repo "${extractOwnerRepo(taskSpec.repoUrl)}"
2. Implementa el código necesario
3. Commitea y haz push a la branch
4. Abre una PR con create_pr
${codebaseSection}${styleSection}${feedbackSection}
Devuelve el resultado como JSON con: prNumber, prUrl, branchName, filesChanged, summary.`;

  const result = await runAgent({
    name: 'CODER',
    systemPrompt,
    userPrompt,
    mcpServerNames: getCoderMcpServers(),
    cwd,
    maxTurns: 50,
    totalTimeout: 900_000, // 15 min — total limit (no idle timer, Windows buffers stdout)
    model,
  });

  if (!result.success || !result.result) {
    return {
      success: false,
      pr: null,
      cost: result.cost,
      duration: result.duration,
      error: result.error || 'El Coder no devolvió un resultado válido',
    };
  }

  const data = result.result;
  const { valid, missing } = validateAgentResponse(data, ['prNumber', 'branchName']);

  if (!valid) {
    logger.warn(`Respuesta del Coder incompleta. Faltan: ${missing.join(', ')}`, 'CODER');
    return {
      success: false,
      pr: null,
      cost: result.cost,
      duration: result.duration,
      error: `Campos faltantes: ${missing.join(', ')}`,
    };
  }

  logger.success(`PR #${data.prNumber} creada: ${data.prUrl || ''}`, 'CODER');

  return {
    success: true,
    pr: {
      prNumber: data.prNumber,
      prUrl: data.prUrl || '',
      branchName: data.branchName,
      filesChanged: data.filesChanged || [],
      summary: data.summary || '',
    },
    cost: result.cost,
    duration: result.duration,
  };
}

/**
 * Ejecuta el agente Coder para arreglar issues encontrados por el Reviewer.
 * Pushea al mismo branch, NO crea nueva PR.
 *
 * @param {Object} taskSpec - Especificación original de la tarea
 * @param {number} prNumber - Número de la PR existente
 * @param {Object} reviewFeedback - Feedback del Reviewer
 * @param {string[]} reviewFeedback.issues - Lista de issues a arreglar
 * @param {string} reviewFeedback.summary - Resumen del Reviewer
 * @param {string} [cwd] - Directorio del repositorio
 * @param {Object} [options] - Additional options
 * @param {string} [options.model] - Model to use (from model-selector)
 * @returns {Promise<{success: boolean, fix: Object|null, cost: number|null, duration: number, error?: string}>}
 */
export async function fixReviewIssues(taskSpec, prNumber, reviewFeedback, cwd, { model } = {}) {
  logger.taskHeader(`CODER - Arreglando issues de PR #${prNumber}`);

  const systemPrompt = getCoderFixSystemPrompt({ enableBrowserMcp: config.enableBrowserMcp });

  const issuesList = (reviewFeedback.issues || [])
    .map((issue, i) => `${i + 1}. ${typeof issue === 'string' ? issue : issue.description || JSON.stringify(issue)}`)
    .join('\n');

  // Build review feedback context (common mistakes to watch for while fixing)
  let feedbackSection = '';
  try {
    const { summary } = getReviewFeedbackContext();
    if (summary) {
      feedbackSection = `\n## ${summary}\n`;
    }
  } catch (err) {
    logger.warn(`Could not generate review feedback: ${err.message}`, 'CODER');
  }

  const userPrompt = `El Reviewer ha encontrado estos problemas en la PR #${prNumber}:

## Feedback del Reviewer
${reviewFeedback.summary || 'Sin resumen'}

## Issues a resolver
${issuesList || 'Sin issues específicos'}

## Contexto de la tarea original
- **Título**: ${taskSpec.title}
- **Branch**: ${taskSpec.branchName}
- **Repo**: ${extractOwnerRepo(taskSpec.repoUrl)}
${feedbackSection}
## Instrucciones
1. Lee el código actual en la branch
2. Arregla CADA issue listado arriba
3. Commitea con mensaje descriptivo (fix: ...)
4. Haz push al branch "${taskSpec.branchName}"
5. NO crees nueva PR

Devuelve el resultado como JSON con: fixed, issuesResolved, filesChanged, summary.`;

  const result = await runAgent({
    name: 'CODER',
    systemPrompt,
    userPrompt,
    mcpServerNames: getCoderMcpServers(),
    cwd,
    maxTurns: 40,
    totalTimeout: 900_000, // 15 min — total limit (no idle timer, Windows buffers stdout)
    model,
  });

  if (!result.success || !result.result) {
    return {
      success: false,
      fix: null,
      cost: result.cost,
      duration: result.duration,
      error: result.error || 'El Coder no devolvió un resultado válido al arreglar',
    };
  }

  const data = result.result;

  if (data.fixed) {
    logger.success(`Issues arreglados y pusheados a ${taskSpec.branchName}`, 'CODER');
  } else {
    logger.warn('Algunos issues no se pudieron resolver', 'CODER');
  }

  return {
    success: !!data.fixed,
    fix: {
      fixed: data.fixed,
      issuesResolved: data.issuesResolved || [],
      issuesNotResolved: data.issuesNotResolved || [],
      filesChanged: data.filesChanged || [],
      summary: data.summary || '',
    },
    cost: result.cost,
    duration: result.duration,
  };
}

/**
 * Extrae owner/repo de una URL de GitHub.
 * "https://github.com/SergioRVDev/komodo" → "SergioRVDev/komodo"
 */
function extractOwnerRepo(repoUrl) {
  if (!repoUrl) return '';
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  return match ? match[1].replace(/\.git$/, '') : repoUrl;
}
