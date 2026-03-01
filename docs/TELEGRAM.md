# Telegram Bot - Guia de Configuracion

Komodo incluye un bot de Telegram que permite controlar el orquestador y recibir notificaciones desde el movil.

## Que puedes hacer

- **Recibir notificaciones** cuando los agentes terminan (Planner, Coder, Reviewer, Merge, errores)
- **Consultar estado** del proyecto: `/status`, `/tasks`, `/backlog`
- **Ejecutar tareas** remotamente: `/run`, `/run 3`, `/run all`, `/dryrun`, `/stop`
- **Terminal Claude Code**: enviar texto libre que se pasa como prompt a Claude Code

## Paso 1: Crear el bot en Telegram

1. Abre Telegram y busca **@BotFather**
2. Envia `/newbot`
3. Elige un nombre para tu bot (ej: "Komodo Bot")
4. Elige un username (debe terminar en `bot`, ej: `komodo_dev_bot`)
5. BotFather te dara un **token** tipo `123456789:ABCdefGHI-jklMNOpqrsTUVwxyz`. Guardalo.

## Paso 2: Obtener tu Chat ID

Necesitas tu Telegram User ID para la whitelist de autorizacion y opcionalmente un Chat ID para notificaciones.

### Opcion A: Usar @userinfobot
1. Busca **@userinfobot** en Telegram
2. Envialo `/start`
3. Te responde con tu **User ID** (numero)

### Opcion B: Usar la API del bot
1. Envia cualquier mensaje a tu bot recien creado
2. Abre en el navegador: `https://api.telegram.org/bot<TU_TOKEN>/getUpdates`
3. Busca el campo `"from": { "id": 123456789 }` — ese es tu User ID
4. El campo `"chat": { "id": 123456789 }` es tu Chat ID (en chats privados es igual al User ID)

## Paso 3: Configurar .env

Abre el `.env` de Komodo y configura las variables de Telegram:

```bash
# Habilitar bot de Telegram
ENABLE_TELEGRAM=true

# Token del bot (de @BotFather)
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI-jklMNOpqrsTUVwxyz

# Chat ID donde enviar notificaciones (tu User ID para chat privado)
TELEGRAM_CHAT_ID=123456789

# IDs de usuarios autorizados, separados por coma
# Solo estos usuarios pueden interactuar con el bot
TELEGRAM_ALLOWED_USERS=123456789

# Timeout para respuestas de Claude Code via terminal (ms, default: 2 min)
TELEGRAM_CLAUDE_TIMEOUT=120000

# Nivel de notificaciones: verbose (todo) o minimal (solo inicio/fin/error)
TELEGRAM_VERBOSITY=verbose
```

### Multiples usuarios

Si quieres que mas personas usen el bot, anade sus IDs separados por coma:

```bash
TELEGRAM_ALLOWED_USERS=123456789,987654321,111222333
```

## Paso 4: Arrancar Komodo

El bot arranca automaticamente con Komodo si `ENABLE_TELEGRAM=true`:

```bash
# Via CLI
node src/index.js run

# O via MCP (el bot arranca cuando Komodo se inicializa)
```

En los logs veras:

```
[TELEGRAM] Telegram bot started
```

## Comandos disponibles

| Comando | Descripcion |
|---------|-------------|
| `/start` | Mensaje de bienvenida |
| `/help` | Lista de comandos |
| `/status` | Estado de Komodo: agente activo, tarea actual, tiempo |
| `/tasks` | Tareas to-do ordenadas por prioridad |
| `/backlog` | Resumen: tareas pendientes, dev points, sprint activo |
| `/run` | Ejecuta 1 tarea |
| `/run N` | Ejecuta N tareas |
| `/run all` | Ejecuta todas las tareas del backlog |
| `/dryrun` | Simula: muestra que tarea elegiria sin ejecutar |
| `/stop` | Detiene la ejecucion actual |
| *texto libre* | Se envia como prompt a Claude Code |

## Notificaciones

El bot envia notificaciones automaticas cuando los agentes trabajan:

| Evento | Contenido |
|--------|-----------|
| Planner elige tarea | Titulo, prioridad, branch |
| Coder termina | PR number, archivos cambiados, resumen |
| Reviewer termina | Verdict (APPROVED/REQUEST_CHANGES), score, issues |
| Fix aplicado | Resumen de fixes |
| PR mergeada | Tarea completada, link a PR |
| Error/rollback | Alerta con detalles del error |

### Verbosidad

- `TELEGRAM_VERBOSITY=minimal` — solo notifica inicio de tarea, fin, merge y errores
- `TELEGRAM_VERBOSITY=verbose` — notifica todos los eventos (PR creada, cada review, cada fix)

## Terminal Claude Code

Cualquier mensaje que no sea un comando `/` se interpreta como prompt para Claude Code:

```
Tu: "lista los archivos en src/telegram/"
Bot: [respuesta formateada de Claude Code]

Tu: "explica como funciona el EventBus"
Bot: [respuesta formateada de Claude Code]
```

El contexto de trabajo es el directorio del repositorio configurado en Komodo. El timeout por defecto es 2 minutos (`TELEGRAM_CLAUDE_TIMEOUT`).

## Seguridad

- **Whitelist**: Solo los User IDs en `TELEGRAM_ALLOWED_USERS` pueden interactuar. Cualquier otro usuario es ignorado con un log de warning.
- **Default deny**: Si la whitelist esta vacia, nadie puede usar el bot.
- El token del bot **nunca** debe commitearse al repositorio. Esta en `.env` que esta en `.gitignore`.

## Troubleshooting

### El bot no arranca
- Verifica que `ENABLE_TELEGRAM=true` en `.env`
- Verifica que `TELEGRAM_BOT_TOKEN` tiene un token valido
- Revisa los logs buscando `[TELEGRAM]`

### No recibo notificaciones
- Verifica que `TELEGRAM_CHAT_ID` tiene tu Chat ID correcto
- Verifica que `TELEGRAM_VERBOSITY` no esta en `minimal` si esperas ver todos los eventos
- Envia `/start` al bot para confirmar que responde

### El bot no responde a mis mensajes
- Verifica que tu User ID esta en `TELEGRAM_ALLOWED_USERS`
- Usa @userinfobot para confirmar tu User ID
- Revisa los logs: si ves `Unauthorized message from <id>`, ese ID no esta en la whitelist

### La terminal Claude Code no responde
- Verifica que `claude` esta instalado y disponible en PATH
- Aumenta `TELEGRAM_CLAUDE_TIMEOUT` si las respuestas son lentas
- Revisa que el directorio de trabajo (cwd) del repositorio es correcto

### Error "polling_error"
- Token invalido: regenera el token con @BotFather (`/revoke` + `/newbot`)
- Conflicto de polling: solo puede haber una instancia del bot corriendo con el mismo token
