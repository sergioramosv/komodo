# PARTE 3: CLI Y ORQUESTADOR

---

## 8. CLI - PUNTO DE ENTRADA (src/index.js)

Commander.js maneja todos los comandos. El CLI es el unico punto de entrada para usuarios.

### Comandos disponibles:

| Comando | Descripcion | Opciones |
|---------|-------------|----------|
| `komodo run` | Ejecutar N tareas | `-p <id>`, `-t <n>`, `-c` (continuo), `--cwd`, `--dry-run` |
| `komodo resume` | Reanudar desde checkpoint | `--cwd` |
| `komodo watch` | Modo daemon (24/7) | `-p <id>`, `--cwd`, `--max-tasks` |
| `komodo multi` | Orquestacion multi-proyecto | `--strategy`, `--cwd` |
| `komodo setup` | Wizard de configuracion | (interactivo) |
| `komodo doctor` | Diagnosticos | (silencioso pre-run) |
| `komodo dashboard` | Lanzar WS + Next.js | - |

### Flujo de `komodo run`:
1. Resolver projectId (de `-p`, o PROJECTS env, o DEFAULT_PROJECT_ID)
2. Ejecutar `doctor({ silent: true })` - auto-diagnostico
3. Verificar checkpoints pendientes con `checkForPendingCheckpoints()`
4. Llamar `run(projectId, { tasks, cwd, dryRun })`

### Graceful shutdown:
```javascript
process.on('SIGINT', async () => {
  const { shutdownManager } = await import('./shutdown/shutdown-manager.js');
  await shutdownManager.shutdown();
  process.exit(0);
});
```

### resolveProjectIdFromEnv():
```javascript
export function resolveProjectIdFromEnv() {
  if (config.projects.length > 0) return config.projects[0];
  if (config.defaultProjectId) return config.defaultProjectId;
  logger.error('No project ID configured');
  process.exit(1);
}
```

---

## 9. ORQUESTADOR PRINCIPAL (src/orchestrator.js)

### 9.1 Exports

```javascript
export { run, resume, checkForPendingCheckpoints };
// Re-exports para acceso externo:
export { eventBus, komodoState, checkpointManager };
```

### 9.2 run(projectId, options)

Esta es la funcion principal. Ejecuta N tareas del backlog secuencialmente.

**Parametros:**
- `projectId` (string) - ID del proyecto en Firebase
- `options.tasks` (number) - Tareas a ejecutar (0 = infinito)
- `options.cwd` (string) - Directorio del repo target
- `options.dryRun` (boolean) - Simular sin ejecutar
- `options.skipServers` (boolean) - No iniciar WS/API (usado por MCP)
- `options.skipHeartbeat` (boolean) - No iniciar heartbeat (usado por MCP)

**Flujo:**
1. Si dryRun: loop de `runTaskDryRun()` y salir
2. Setear estado: `komodoState.setExecutionState('running')`
3. Cargar plugins: `loadPlugins()` (trigger codebase learning)
4. Iniciar servidores: WS (port 3001), API (port 3002) - si no skipServers
5. Iniciar monitores: HeartbeatMonitor, BudgetManager, ResilienceManager
6. Registrar shutdown hooks
7. **Loop principal:**
   - Verificar pause/stop request
   - Verificar budget exceeded
   - Ejecutar `runTask(projectId, cwd)`
   - Si null → backlog vacio, break
   - Si rateLimited → checkpoint guardado, break
   - Si success → incrementar contador
   - Si error → log y continuar (graceful degradation)
8. Finally: cleanup via `shutdownManager.shutdown()`

### 9.3 resume(options)

Reanuda desde un checkpoint de rate limit.

**Flujo:**
1. Listar checkpoints pendientes
2. Cargar el mas reciente
3. Validar (no expirado >24h, datos validos)
4. Ejecutar `resumeTask(checkpoint, cwd)`
5. Borrar checkpoint al completar
6. Cleanup

### 9.4 checkForPendingCheckpoints(options)

Detecta y opcionalmente auto-reanuda checkpoints pendientes.

**Flujo:**
1. Listar checkpoints
2. Si no hay, return
3. Validar el mas reciente
4. Si `CHECKPOINT_AUTO_RESUME=true` → auto-resume
5. Si no → log "Run komodo resume"

---

## 10. SETUP WIZARD (src/setup.js)

Wizard interactivo de 12 pasos usando readline:

1. **Prerequisites**: Verificar Node, git, gh, CLIs de IA
2. **Select CLIs**: Planner, Coder, Reviewer CLI selection
3. **Firebase**: Credenciales y database URL
4. **User Identity**: UID y nombre
5. **GitHub**: Token + Issue Sync
6. **Basic Preferences**: Project ID, auto-merge, max review cycles
7. **Budget**: Daily/weekly USD limits
8. **Rate Limit**: Fallback + complexity thresholds
9. **Servers**: WS + API ports
10. **Browser MCP**: Chrome DevTools toggle
11. **Advanced**: SonarQube + Plugins
12. **Generate .env**: Escribe archivo completo

Post-setup:
- `npm install` en root y cada skill
- `claude mcp add komodo-mcp` - registro global
- Actualizar `.claude/settings.local.json` con permisos
