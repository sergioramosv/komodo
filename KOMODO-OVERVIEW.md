# Komodo - Orquestador de Agentes IA para Desarrollo de Software

## Que es Komodo

Komodo es un sistema que coordina agentes de IA (Planner, Coder, Reviewer) para desarrollar software de forma automatica. Le das un backlog de tareas y Komodo las ejecuta una por una: elige la tarea mas prioritaria, escribe el codigo, abre una Pull Request, la revisa con criterios estrictos, corrige lo que haga falta, y mergea cuando esta aprobada.

## Como funciona

1. **Planner** analiza el backlog y elige la tarea de mayor prioridad (bizPoints/devPoints)
2. **Coder** crea un branch, implementa el codigo, commitea, pushea y abre una PR
3. **Reviewer** revisa la PR con 8 criterios (correctitud, seguridad, tests, naming, etc.)
4. Si hay issues, Coder los corrige y Reviewer re-revisa (max N rondas configurables)
5. PR aprobada → merge automatico (squash) + tarea marcada como completada

## Que puedes hacer con Komodo

- **Ejecutar tareas automaticamente** desde un backlog en Firebase
- **Usar cualquier CLI de IA** como agente: Claude Code, Codex, Gemini
- **Controlar todo desde un dashboard web** con animaciones 3D en tiempo real
- **Operar via Telegram**: recibir notificaciones, ejecutar tareas, terminal remota
- **Integrar con herramientas externas** via webhooks, API REST y plugins custom
- **Correr en modo daemon 24/7** con auto-recovery ante rate limits
- **Analisis de calidad** automatico con SonarQube integrado
- **Multi-proyecto**: gestionar varios repositorios simultaneamente

---

## Sprints

### Sprint 0 — Inicializacion del Proyecto

Setup inicial: crear el repositorio en GitHub y la estructura base del proyecto. El punto de partida de todo Komodo.

---

### Sprint 1 — Scaffold y Configuracion Base

La base del proyecto: `package.json` con dependencias, sistema de configuracion via `.env` con validacion, logger con colores para la terminal, parser para extraer JSON de las respuestas de los agentes IA, y archivos de ejemplo/gitignore.

---

### Sprint 2 — GitHub MCP (Model Context Protocol)

Servidor MCP que da a los agentes IA acceso completo a GitHub: crear y listar branches, abrir/consultar Pull Requests, ver diffs, hacer reviews, mergear y cerrar PRs. Todo a traves del CLI `gh` de GitHub. Este es el "brazo" de Komodo para interactuar con repositorios.

---

### Sprint 3 — Memory MCP

Servidor MCP de memoria persistente para los agentes. Almacena patrones de errores recurrentes, estadisticas de reviews y outcomes historicos en JSON local. Los agentes pueden consultar patrones antes de codear y registrar resultados despues de cada review, permitiendo que Komodo "aprenda" de errores pasados.

---

### Sprint 4 — Sistema de Agentes

El corazon del sistema: wrapper `base-agent.js` que lanza cualquier CLI de IA como subproceso, y los 3 agentes especializados con sus system prompts:
- **Planner**: analiza backlog, calcula prioridad, respeta dependencias
- **Coder**: implementa tareas completas (branch → codigo → PR)
- **Reviewer**: revisa PRs con 8 criterios estrictos y scoring 0-10

---

### Sprint 5 — Orquestacion y CLI

El flujo completo de ejecucion: review loop (Coder ↔ Reviewer hasta APPROVED), task runner (ciclo completo de 1 tarea de principio a fin), orquestador (ejecutar N tareas o modo continuo hasta vaciar backlog), y CLI con `commander` para controlar todo desde la terminal (`node src/index.js run -t 3`).

---

### Sprint 6 — Pulido, Setup y Testing

Experiencia de usuario y robustez: wizard de instalacion interactivo (`setup.js`), manejo de errores con recovery automatico (cerrar PRs huerfanas, devolver tareas a to-do), tracking de costes de API, modo `--dry-run` para simular sin ejecutar, y test end-to-end con una tarea real.

---

### Sprint 7 — API de Estado en Tiempo Real

Infraestructura de eventos: EventBus interno que emite eventos de estado (agente cambia de fase, tarea completada, PR abierta), servidor WebSocket para enviar estos eventos al dashboard en tiempo real, y modelo de estado global (`komodoState`) que centraliza toda la informacion del sistema.

---

### Sprint 8 — Dashboard Web: Setup y Layout

Dashboard web con Next.js: pagina principal con panel de estado en tiempo real (que agente esta activo, que tarea se esta ejecutando, progreso), pagina de Settings para configurar Komodo, y pagina de Memory para visualizar los patrones de error almacenados por el Memory MCP.

---

### Sprint 9 — Visualizacion Animada: La Oficina de Komodo

Visualizacion animada en el dashboard: una "oficina virtual" donde los agentes se mueven entre zonas (sala de espera, escritorio, zona de review). Sprites y avatares con animaciones basicas, movimiento conectado al estado real via WebSocket, y elementos decorativos con feedback visual (burbujas de pensamiento, indicadores de progreso).

---

### Sprint 10 — Dashboard: Pagina de Agentes y Controles

Pagina dedicada para cada agente con logs en vivo, controles de ejecucion desde el dashboard (Start, Pause, Stop), notificaciones al completar tareas, y servidor WebSocket standalone para el modo MCP (cuando Komodo se usa como servidor MCP en vez del CLI).

---

### Sprint 11 — Komodo MCP: Control desde Claude Code

Komodo como servidor MCP: en vez de usar el CLI, puedes controlar Komodo directamente desde Claude Code (o cualquier cliente MCP) con tools como `komodo_plan`, `komodo_code`, `komodo_review`, `komodo_fix`, `komodo_finalize`. Flujo paso a paso con visibilidad total, o `komodo_run` para ejecucion automatica.

---

### Sprint 12 — MCP Chrome DevTools: Agentes con Acceso al Navegador

Integracion con Chrome DevTools via MCP: los agentes pueden abrir el navegador, inspeccionar la app, ver errores de consola y validar visualmente. El Coder verifica que su codigo funciona en el browser, el Reviewer puede hacer checks visuales, y el dashboard muestra el estado de los browser checks.

---

### Sprint 13 — Telegram Bot: Setup y Notificaciones

Bot de Telegram con autenticacion: recibe notificaciones en tiempo real de cada paso del flujo (tarea iniciada, PR abierta, review completado, merge). Comandos de consulta: `/status` (estado actual), `/tasks` (tareas en progreso), `/backlog` (tareas pendientes).

---

### Sprint 14 — Telegram Bot: Control y Terminal Remota

Control completo de Komodo desde Telegram: comando `/run` para ejecutar tareas, pause/stop remotos. Terminal de Claude Code via Telegram: puedes enviar prompts a Claude Code directamente desde el chat de Telegram y recibir las respuestas, como una terminal remota desde el movil.

---

### Sprint 15 — Integracion SonarQube: Analisis de Calidad Automatizado

Analisis estatico de codigo con SonarQube integrado en el flujo: despues de que el Coder termina, SonarQube analiza el codigo (bugs, vulnerabilidades, code smells, cobertura, duplicacion). El reporte se inyecta en el prompt del Reviewer para que tome decisiones informadas. Dashboard y CLI muestran el estado del analisis.

---

### Sprint 16 — Rate Limit Resilience y Task Decomposition

Resiliencia ante rate limits de las APIs de IA: deteccion automatica, checkpoint del estado, fallback a otro CLI alternativo, y reanudacion desde donde se quedo. Ademas, sistema de dependencias entre tareas (`blockedBy`), triage automatico que descompone tareas grandes en subtareas, clasificacion de complejidad, y seleccion automatica de modelo (Opus/Sonnet/Haiku) segun la dificultad.

---

### Sprint 17 — Heartbeat: Auto-Recovery Inteligente

Monitor de heartbeat que hace ping periodico a los CLIs de IA para detectar cuando se recuperan de un rate limit. Auto-resume automatico cuando el heartbeat es positivo, dashboard de salud en tiempo real de cada CLI, backoff exponencial inteligente con parsing de `retry-after`, y notificaciones de recovery via Telegram y WebSocket.

---

### Sprint 18 — Daemon Mode: Komodo 24/7

Modo daemon que corre continuamente: Komodo escucha el backlog y auto-ejecuta tareas cuando aparecen. Scheduler con ventanas de ejecucion programables (ej: solo de 9am a 6pm), watchdog timer que mata agentes colgados y reintenta, self-diagnostic completo al arrancar, y graceful shutdown que persiste el estado antes de apagarse.

---

### Sprint 19 — Auto-Alimentacion: El Backlog Nunca se Vacia

Fuentes automaticas de tareas: GitHub Issues se convierten en tareas del backlog, comentarios en PRs generan bug reports automaticos, cuando el backlog se vacia Komodo sugiere refactorings, issues menores del Reviewer se acumulan como tech debt y se convierten en tareas, y un bot de dependencias detecta y actualiza librerias vulnerables.

---

### Sprint 20 — Inteligencia: Komodo Aprende

Sistema de aprendizaje continuo: indice semantico del codebase (mapa de modulos, funciones, relaciones), deteccion automatica de convenciones de estilo del codigo existente, feedback loop que inyecta errores frecuentes en el prompt del Coder, comparacion de estimaciones vs realidad para mejorar, ordenamiento inteligente de tareas por contexto compartido, y coding guidelines custom por proyecto.

---

### Sprint 21 — Quality Gate: Nunca Mergear Codigo Roto

Garantias de calidad: el Coder ejecuta tests antes de abrir la PR, monitor de GitHub Actions post-merge, auto-revert automatico de PRs que rompen main, rechazo de PRs que bajan la cobertura de tests, y un agente QA dedicado que genera y ejecuta tests automaticamente.

---

### Sprint 22 — Parallel Execution: Multiplicar Throughput

Ejecucion en paralelo: multiples tareas independientes se ejecutan simultaneamente, worker pool con dispatcher y sistema de colas, smart batching que agrupa tareas triviales en una sola PR, y review incremental que solo re-revisa los archivos que cambiaron en cada fix cycle.

---

### Sprint 23 — Versionado y Releases Automaticos

Gestion automatica de versiones: semantic versioning automatico tras cada merge (patch/minor/major segun el tipo de cambio), changelog auto-generado desde las tareas completadas, GitHub Releases automaticos al cerrar un sprint, y release gates que bloquean la release si hay bugs criticos abiertos.

---

### Sprint 24 — Observabilidad Total

Metricas y analytics completos: persistencia de todos los eventos en Firebase, dashboard con graficos de tendencia historicos, cost tracking con alertas de presupuesto y auto-pause cuando se excede, leaderboard de rendimiento por modelo (que modelo es mejor para cada rol), y digest semanal automatico via Telegram con resumen de metricas.

---

### Sprint 25 — Ecosystem: Webhooks, Plugins y Multi-Proyecto

Extensibilidad total: webhooks outgoing para emitir eventos a URLs externas, API REST incoming para controlar Komodo desde cualquier herramienta, sistema de plugins para registrar agentes custom, ejecucion multi-proyecto simultanea con estrategias de seleccion (round-robin, prioridad, tamanio de backlog), dashboard multi-proyecto con vista agregada, y rate limiting en la API.
