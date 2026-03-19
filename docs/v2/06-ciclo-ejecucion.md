# PARTE 6: CICLO DE EJECUCION (Task Runner + Review Loop)

---

## 23. TASK RUNNER (src/cycle/task-runner.js)

### 23.1 Proposito
Pipeline completo de ejecucion de una tarea: desde seleccion hasta merge.

### 23.2 runTask(projectId, cwd)

**Flujo completo (10 fases):**

```
1. PLANNING     → Planner selecciona tarea
2. TRIAGE       → Clasificar complejidad, seleccionar modelo
3. DECOMPOSE    → Si tarea grande (>8 devPoints), descomponer
4. ARCHITECTING → Architect genera plan de implementacion
5. CODING       → Coder implementa, abre PR
6. TESTING      → QA genera tests, Tester genera tests quirurgicos
7. SECURITY     → Security agent escanea vulnerabilidades
8. PRE-PR TESTS → Ejecutar tests automaticos
9. SONARQUBE    → Analisis de calidad (si habilitado)
10. REVIEW LOOP → Reviewer ↔ Coder loop (max N ciclos)
11. MERGE       → Auto-merge o aprobacion manual
12. POST-MERGE  → Version bump, changelog, CI monitor, tech debt
```

**Implementacion detallada:**

```javascript
export async function runTask(projectId, cwd) {
  // === PHASE 1: PLANNING ===
  komodoState.setPhase('planning');
  komodoState.setAgentState('PLANNER', 'working');

  const taskResult = await pickNextTask(projectId, {
    cwd,
    lastCompletedTaskContext: komodoState.lastCompletedTaskContext,
  });

  if (!taskResult) return null; // Backlog vacio

  const taskSpec = taskResult;
  komodoState.setCurrentTask(taskSpec.title);
  komodoState.setTaskDetails(taskSpec);
  komodoState.setAgentState('PLANNER', 'done');

  // Change task status to in-progress
  await changeTaskStatus(taskSpec.taskId, 'in-progress');

  eventBus.emitEvent('TASK_STARTED', {
    taskId: taskSpec.taskId,
    title: taskSpec.title,
    devPoints: taskSpec.devPoints,
  });

  let totalCost = taskResult.cost || 0;

  try {
    // === PHASE 2: TRIAGE ===
    const complexity = classifyComplexity(taskSpec);
    const selectedModel = selectModel('coder', complexity);

    eventBus.emitEvent('TASK_CLASSIFIED', {
      taskId: taskSpec.taskId,
      complexity,
      model: selectedModel,
    });

    // === PHASE 3: DECOMPOSE (optional) ===
    if (config.taskDecomposition && taskSpec.devPoints >= config.taskDecompositionThreshold) {
      const decomposed = await decomposeTask(taskSpec, projectId);
      if (decomposed) {
        logger.info(`Task decomposed into ${decomposed.subtasks.length} subtasks`);
        // Return and let next iteration pick subtask
        return { success: true, decomposed: true };
      }
    }

    // === PHASE 4: ARCHITECTING (optional) ===
    let architectPlan = null;
    if (config.cliArchitect && taskSpec.devPoints >= 5) {
      komodoState.setPhase('architecting');
      komodoState.setAgentState('ARCHITECT', 'working');

      const archResult = await analyzeTask(taskSpec, cwd, {
        model: selectModel('architect', complexity),
      });

      if (archResult.success) {
        architectPlan = archResult.plan;
        totalCost += archResult.cost;
      }

      komodoState.setAgentState('ARCHITECT', 'done');
    }

    // === PHASE 5: CODING ===
    komodoState.setPhase('coding');
    komodoState.setAgentState('CODER', 'working');

    // Build knowledge context
    const knowledgeContext = await buildKnowledgeContext(taskSpec, projectId);
    const learningContext = await getLearningContext(cwd);
    const codingGuidelines = await getCodingGuidelines(projectId);

    const codeResult = await implementTask(taskSpec, cwd, {
      architectPlan,
      model: selectedModel,
      codingGuidelines,
      knowledgeContext,
      learningContext,
    });

    totalCost += codeResult.cost;

    if (!codeResult.success) {
      if (codeResult.rateLimited) {
        await saveCheckpoint(taskSpec, 'code', { cwd });
        return { rateLimited: true };
      }
      throw new Error(`Coder failed: ${codeResult.error}`);
    }

    const { prNumber, branchName, filesChanged } = codeResult.pr;
    const repo = extractOwnerRepo(taskSpec.repoUrl);

    komodoState.setCurrentPR({ number: prNumber });
    komodoState.setAgentState('CODER', 'done');

    eventBus.emitEvent('PR_CREATED', {
      taskId: taskSpec.taskId,
      prNumber,
      branchName,
    });

    // Record Coder decisions in Knowledge Graph
    await recordCoderDecisions(taskSpec, codeResult, projectId);

    // === PHASE 6: TESTING (optional, parallel) ===
    let qaReport = null;
    let testerReport = null;

    if (config.enableQAAgent || config.enableTesterAgent) {
      komodoState.setPhase('testing');

      const testPromises = [];

      if (config.enableQAAgent) {
        komodoState.setAgentState('TESTER', 'working'); // Visual: TESTER card
        testPromises.push(
          runQAAgent({
            taskSpec, filesChanged, branchName, repo, prNumber, cwd,
            model: selectModel('qa', complexity),
          }).then(r => { qaReport = r; totalCost += r.cost; })
        );
      }

      if (config.enableTesterAgent) {
        testPromises.push(
          runTesterAgent({
            taskSpec, filesChanged, branchName, repo, prNumber, projectId, cwd,
            model: selectModel('tester', complexity),
          }).then(r => { testerReport = r; totalCost += r.cost; })
        );
      }

      await Promise.all(testPromises);
      komodoState.setAgentState('TESTER', 'done');
    }

    // === PHASE 7: SECURITY (optional) ===
    let securityReport = null;

    if (config.enableSecurityAgent) {
      komodoState.setPhase('security');
      komodoState.setAgentState('SECURITY', 'working');

      securityReport = await runSecurityAgent({
        taskSpec, filesChanged, branchName, repo, prNumber, cwd,
        model: selectModel('security', complexity),
      });
      totalCost += securityReport.cost;

      if (securityReport.security?.verdict === 'BLOCK') {
        logger.error('Security BLOCK: Critical vulnerabilities found');
        // Continue to review - reviewer will factor this in
      }

      komodoState.setAgentState('SECURITY', 'done');
    }

    // === PHASE 8: PRE-PR TESTS (optional) ===
    if (config.prePrTests) {
      await executePrePRTests(cwd, branchName);
    }

    // === PHASE 9: SONARQUBE (optional) ===
    let sonarReport = null;

    if (config.enableSonar) {
      komodoState.setPhase('analyzing');
      sonarReport = await analyzeSonar(cwd, branchName);
    }

    // === PHASE 10: REVIEW LOOP ===
    komodoState.setPhase('reviewing');

    // Load plugins for before-review hooks
    const pluginIssues = await runPluginHook('before-review', { taskSpec, prNumber, filesChanged });

    // Get coverage report
    const coverageReport = await analyzeCoverage(cwd, branchName);

    const reviewResult = await reviewLoop({
      prNumber,
      repo,
      taskSpec,
      cwd,
      sonarReport,
      coverageReport,
      qaReport: qaReport?.qa,
      securityReport: securityReport?.security,
      reviewerModel: selectModel('reviewer', complexity),
      coderModel: selectedModel,
      codingGuidelines,
      pluginIssues,
      escalationThreshold: config.reviewEscalationThreshold,
      knowledgeContext,
      filesChanged,
    });

    totalCost += reviewResult.cost;

    // === PHASE 11: MERGE ===
    if (reviewResult.approved) {
      komodoState.setPhase('merging');

      if (config.autoMerge) {
        // Squash merge via gh CLI
        await mergePR(repo, prNumber);
        await changeTaskStatus(taskSpec.taskId, 'to-validate');

        eventBus.emitEvent('PR_MERGED', {
          taskId: taskSpec.taskId,
          prNumber,
          reviewCycles: reviewResult.cycles,
        });
      } else {
        // Mark for manual merge
        await changeTaskStatus(taskSpec.taskId, 'to-validate');
        logger.info(`PR #${prNumber} approved. Manual merge required.`);
      }

      // === PHASE 12: POST-MERGE ===

      // Version bump
      if (config.autoVersion) {
        await bumpVersion(cwd, complexity);
      }

      // Changelog
      if (config.autoChangelog) {
        await generateChangelog(cwd, taskSpec);
      }

      // CI Monitor
      if (config.ciMonitor) {
        monitorCI(repo, branchName, prNumber).catch(err => {
          logger.warn(`CI monitor error: ${err.message}`);
        });
      }

      // Tech debt
      if (reviewResult.finalReview?.issues?.length > 0) {
        const minorIssues = reviewResult.finalReview.issues.filter(i => i.severity === 'minor');
        if (minorIssues.length > 0) {
          await createTechDebtTasks(minorIssues, taskSpec, projectId);
        }
      }

      // Record metrics
      await recordTaskMetrics(taskSpec, {
        totalCost,
        reviewCycles: reviewResult.cycles,
        duration: Date.now() - startTime,
        model: selectedModel,
        approved: true,
      });

    } else {
      // Review rejected after max cycles
      logger.warn(`Task ${taskSpec.title} not approved after ${reviewResult.cycles} cycles`);
      await changeTaskStatus(taskSpec.taskId, 'to-do'); // Back to backlog
    }

    // Update context for smart ordering
    komodoState.setLastCompletedTaskContext({
      files: filesChanged,
      modules: extractModules(filesChanged),
      keywords: extractKeywords(taskSpec.title),
    });

    komodoState.setPhase('idle');
    return {
      success: reviewResult.approved,
      taskId: taskSpec.taskId,
      totalCost,
      cycles: reviewResult.cycles,
    };

  } catch (error) {
    logger.error(`Task ${taskSpec.title} failed: ${error.message}`);
    komodoState.setPhase('idle');
    return { success: false, error: error.message, totalCost };
  }
}
```

### 23.3 runTaskDryRun(projectId)

Simula la seleccion sin ejecutar:
```javascript
export async function runTaskDryRun(projectId) {
  const tasks = await fetchProjectTasks(projectId);
  const todo = tasks.filter(t => t.status === 'to-do');
  const { eligible } = filterBlockedTasks(todo, tasks);
  if (eligible.length === 0) return null;
  return { task: eligible[0] };
}
```

### 23.4 resumeTask(checkpoint, cwd)

Reanuda desde un checkpoint guardado (ej: despues de rate limit):

```javascript
export async function resumeTask(checkpoint, cwd) {
  const { taskSpec, flowStep, prNumber, branchName, sonarReport, reviewCycle } = checkpoint;

  switch (flowStep) {
    case 'code':
      // Resume from coding phase
      return runTaskFromCoding(taskSpec, cwd);
    case 'fix':
      // Resume from fix phase
      return runTaskFromFix(taskSpec, prNumber, checkpoint.reviewIssues, cwd);
    case 'review':
      // Resume from review phase
      return runTaskFromReview(taskSpec, prNumber, cwd, { sonarReport, reviewCycle });
    case 'merge':
      // Resume from merge phase
      return runTaskFromMerge(taskSpec, prNumber, cwd);
    default:
      throw new Error(`Unknown flow step: ${flowStep}`);
  }
}
```

---

## 24. REVIEW LOOP (src/cycle/review-loop.js)

### 24.1 reviewLoop(options)

**Parametros:**
```javascript
{
  prNumber, repo, taskSpec, cwd,
  sonarReport, coverageReport, qaReport, securityReport,
  reviewerModel, coderModel, codingGuidelines,
  pluginIssues, escalationThreshold,
  coderCli, knowledgeContext, filesChanged,
}
```

**Flujo del loop:**

```javascript
export async function reviewLoop(options) {
  const maxCycles = config.maxReviewCycles;
  let totalCost = 0;
  let lastReviewSHA = null;
  let sonarReport = options.sonarReport;
  let escalatedCoderModel = null;
  const depthBreakdown = {};

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    // --- REVIEW ---
    komodoState.setReviewCycle(cycle);
    eventBus.emitEvent('REVIEW_CYCLE_START', { cycle, maxCycles });

    const reviewResult = await reviewPR({
      ...options,
      reviewCycle: cycle,
      lastReviewSHA,
      // Knowledge context only on cycle 1
      knowledgeContext: cycle === 1 ? options.knowledgeContext : null,
    });

    totalCost += reviewResult.cost;
    lastReviewSHA = reviewResult.reviewSHA;
    depthBreakdown[reviewResult.reviewDepth] = (depthBreakdown[reviewResult.reviewDepth] || 0) + 1;

    // --- VERDICT CHECK ---
    if (reviewResult.review.verdict === 'APPROVED') {
      // Record avoided patterns in memory
      await recordAvoidedPatterns(reviewResult, options.taskSpec);
      return {
        approved: true,
        cycles: cycle,
        finalReview: reviewResult.review,
        cost: totalCost,
        sonarReport,
        depthBreakdown,
      };
    }

    // Last cycle and still not approved → give up
    if (cycle === maxCycles) {
      return {
        approved: false,
        cycles: cycle,
        finalReview: reviewResult.review,
        cost: totalCost,
        sonarReport,
        depthBreakdown,
        error: `Not approved after ${maxCycles} cycles`,
      };
    }

    // --- AUTO-ESCALATION (cycle 1 only) ---
    if (cycle === 1 && reviewResult.review.score < options.escalationThreshold) {
      escalatedCoderModel = escalateModel(options.coderModel);
      eventBus.emitEvent('MODEL_ESCALATED', {
        from: options.coderModel,
        to: escalatedCoderModel,
        reason: `Score ${reviewResult.review.score} < threshold ${options.escalationThreshold}`,
      });
    }

    // --- CODER FIX ---
    komodoState.setAgentState('CODER', 'working');

    const fixResult = await fixReviewIssues(
      options.taskSpec,
      options.prNumber,
      reviewResult.review,
      options.cwd,
      {
        model: escalatedCoderModel || options.coderModel,
        codingGuidelines: options.codingGuidelines,
      }
    );

    totalCost += fixResult.cost;
    komodoState.setAgentState('CODER', 'done');

    // --- RE-RUN SONARQUBE after fix ---
    if (sonarReport && config.enableSonar) {
      sonarReport = await analyzeSonar(options.cwd, options.taskSpec.branchName);
    }

    // Record review issues in memory
    await recordReviewIssues(reviewResult.review.issues, options.taskSpec);
  }
}
```

### 24.2 Model escalation

```javascript
function escalateModel(currentModel) {
  const escalation = {
    'haiku': 'sonnet',
    'sonnet': 'opus',
    'codex-mini': 'o4-mini',
    'o4-mini': 'o3',
    'gemini-2.0-flash': 'gemini-2.5-pro',
  };
  return escalation[currentModel] || currentModel;
}
```

### 24.3 Incremental review

En ciclos 2+, el reviewer solo analiza el diff desde el ultimo review:
- Se usa `lastReviewSHA` para calcular el diff incremental
- Ahorra ~40-60% de tokens
- Metricas tracked: tokens ahorrados, % reduccion

---

## 25. INCREMENTAL REVIEW (src/cycle/incremental-review.js)

```javascript
export function buildIncrementalContext(lastReviewSHA, currentSHA, fullDiff) {
  // Generate diff between lastReviewSHA and currentSHA
  // Return: { incrementalDiff, filesChanged, tokenEstimate }

  // If no previous SHA, return full diff
  if (!lastReviewSHA) return { incrementalDiff: fullDiff, isIncremental: false };

  // Use git diff between SHAs
  const diff = execSync(
    `git diff ${lastReviewSHA}..${currentSHA}`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );

  return {
    incrementalDiff: diff,
    isIncremental: true,
    tokensSaved: estimateTokens(fullDiff.length) - estimateTokens(diff.length),
    reductionPercent: Math.round((1 - diff.length / fullDiff.length) * 100),
  };
}
```

---

## 26. PIPELINE SCHEDULER (src/cycle/pipeline-scheduler.js)

Permite ejecutar agentes independientes en paralelo:

```javascript
export async function runParallelAgents(agents, options = {}) {
  const { maxConcurrent = config.maxConcurrentAgents || 1 } = options;

  // QA + Security pueden correr en paralelo
  // Tester puede correr en paralelo con QA
  // Reviewer SIEMPRE es secuencial (necesita resultados previos)

  const controller = new AbortController();
  const results = {};

  const parallelGroup = agents.filter(a => a.parallel);
  const sequentialGroup = agents.filter(a => !a.parallel);

  // Run parallel group
  if (parallelGroup.length > 0) {
    const promises = parallelGroup.map(agent =>
      agent.execute({ signal: controller.signal })
        .then(r => { results[agent.name] = r; })
        .catch(err => { results[agent.name] = { error: err.message }; })
    );
    await Promise.all(promises);
  }

  // Run sequential group
  for (const agent of sequentialGroup) {
    results[agent.name] = await agent.execute({ signal: controller.signal });
  }

  return results;
}
```
