# Como se resolvio el bug de Windows en Komodo

Este documento explica un bug critico que impedia a Komodo funcionar en Windows, como se diagnostico, como se resolvio, y como funciona ahora. Tiene dos secciones: una explicacion simple para cualquier persona, y una explicacion tecnica detallada.

---

## Explicacion simple (para todos)

### Que pasaba?

Komodo necesita pedirle cosas a programas de inteligencia artificial (como Claude). Para hacerlo, le envia instrucciones con texto largo que incluye identificadores de proyectos (codigos como `-OmFjaFM9glBQnBTT7QQ`).

El problema era que **en Windows, estas instrucciones se rompian al llegar**. El codigo del proyecto (`-OmFjaFM9glBQnBTT7QQ`) empieza con un guion `-`, y Windows lo confundia con un comando del programa, no con un dato. Era como si intentaras decirle a alguien por telefono "busca el archivo -importante" y la persona entendiera que le estas diciendo "-importante" como una instruccion del telefono, no como el nombre del archivo.

El error exacto era:
```
error: unknown option '-OmFjaFM9glBQnBTT7QQ'
```

### Como se arreglo?

Antes, Komodo le decia a Claude las instrucciones "gritandolas en voz alta" (como argumentos del programa). Windows procesaba ese grito y lo malinterpretaba.

Ahora, Komodo le pasa las instrucciones "por escrito en un papel" (a traves de un canal directo llamado stdin). De esta forma, Windows nunca ve el contenido de las instrucciones -- solo le llega directamente a Claude tal cual, sin que nadie lo procese ni lo rompa en el camino.

### Funciona en todos los sistemas?

Si. La solucion funciona identicamente en Windows, Linux y macOS. No hay codigo especifico para cada sistema operativo en lo que respecta al envio de instrucciones.

---

## Explicacion tecnica detallada

### Contexto: como lanza Komodo los agentes IA

Komodo ejecuta agentes IA (Claude Code, Codex, Gemini CLI) como subprocesos de Node.js usando `child_process.spawn()`. Cada agente recibe:

1. **Argumentos CLI** -- flags como `--output-format json`, `--mcp-config path/to/config.json`
2. **System prompt** -- instrucciones de rol (ej: "Eres el Planner de Komodo...")
3. **User prompt** -- la tarea concreta (ej: `Analiza el backlog del proyecto "-OmFjaFM9glBQnBTT7QQ" y elige...`)

### El bug: shell escaping en Windows

En Windows, Node.js necesita `shell: true` en `spawn()` para resolver ejecutables instalados globalmente via npm (como `claude.cmd`). Cuando `shell: true` esta activo, Node.js delega la ejecucion a `cmd.exe`.

El codigo anterior pasaba los prompts como argumentos CLI:

```javascript
// CODIGO ANTERIOR (roto)
const args = [
  '-p', userPrompt,           // <-- El prompt como argumento CLI
  '--system-prompt', systemPrompt,
  '--output-format', 'json',
  '--mcp-config', mcpConfigPath,
];
spawn('claude', args, { shell: true });
```

#### Que hacia cmd.exe con esto?

Cuando Node.js pasa `['-p', 'Analiza el proyecto "-OmFjaFM9glBQnBTT7QQ"']` a `spawn` con `shell: true`, internamente construye un string de comando para cmd.exe:

```
cmd.exe /d /s /c "claude -p Analiza el proyecto "-OmFjaFM9glBQnBTT7QQ" --output-format json"
```

Observa el problema: las comillas `"` que estan **dentro** del prompt se mezclan con las comillas del comando. `cmd.exe` interpreta las comillas de forma diferente a bash:

1. La primera `"` antes de `-OmFjaFM9glBQnBTT7QQ` cierra el string anterior
2. `-OmFjaFM9glBQnBTT7QQ` aparece como un argumento separado, fuera de comillas
3. Al empezar con `-`, el CLI de Claude lo interpreta como un flag desconocido

**Resultado:** `error: unknown option '-OmFjaFM9glBQnBTT7QQ'`

#### Intentos fallidos de solucion

1. **Escapar con `\"`**: `cmd.exe` no entiende `\"` (eso es una convencion de C runtime, no del shell de Windows)
2. **Escapar con `""`**: Funciona a veces en cmd.exe, pero no es fiable con `CommandLineToArgvW` del sistema
3. **Solo en Windows**: Se intento hacer el fix solo para Windows, pero no era robusto

### La solucion: stdin pipe

La solucion definitiva es **no pasar los prompts como argumentos CLI en absoluto**. En vez de eso, se envian a traves de stdin (standard input), que es un canal de datos directo entre procesos:

```javascript
// CODIGO ACTUAL (funciona en todas las plataformas)

// Solo flags cortos y seguros como argumentos
const args = [
  '--output-format', 'json',
  '--mcp-config', mcpConfigPath,
  '--strict-mcp-config',
  '--max-turns', String(maxTurns),
  '--permission-mode', 'bypassPermissions',
];

// Combinar system + user prompt
const stdinData = `${systemPrompt}\n\n---\n\n${userPrompt}`;

// Spawnar proceso
const child = spawn('claude', args, {
  stdio: ['pipe', 'pipe', 'pipe'],  // stdin es un pipe
  shell: process.platform === 'win32',
});

// Enviar prompt por stdin -- NO como argumento CLI
child.stdin.write(stdinData);
child.stdin.end();
```

#### Por que funciona?

1. **stdin es un canal de datos binario**. No pasa por ningun shell. No hay quoting, escaping ni parsing -- son bytes directos del proceso padre al proceso hijo.

2. **Claude CLI detecta stdin automaticamente**. Cuando stdin no es un TTY (terminal interactivo) sino un pipe, Claude CLI lee el prompt de stdin en vez de esperar input interactivo. Esto es un comportamiento estandar documentado: `echo "prompt" | claude --output-format json`.

3. **Los argumentos CLI son simples y seguros**. Solo pasamos flags cortos que no contienen caracteres especiales: `--output-format`, `--mcp-config`, `--max-turns`. Ningun argumento contiene comillas, guiones problematicos ni texto largo.

4. **Funciona identicamente en todas las plataformas**. `child.stdin.write()` de Node.js funciona igual en Windows, Linux y macOS. No depende del shell.

### Arquitectura del adaptador

El sistema usa adaptadores por CLI. Cada adaptador tiene 3 metodos:

| Metodo | Que hace | Donde van los datos |
|--------|----------|---------------------|
| `buildArgs()` | Construye flags CLI | `spawn('claude', args)` |
| `buildStdin()` | Combina system + user prompt | `child.stdin.write(data)` |
| `parseOutput()` | Parsea stdout del CLI | Interno |

```javascript
const CLI_ADAPTERS = {
  claude: {
    buildArgs({ mcpConfigPath, maxTurns, model }) {
      // Solo flags seguros -- NUNCA prompts
      const args = ['--output-format', 'json'];
      if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath);
      if (maxTurns) args.push('--max-turns', String(maxTurns));
      args.push('--permission-mode', 'bypassPermissions');
      return args;
    },

    buildStdin({ systemPrompt, userPrompt }) {
      // Combinar todo para stdin
      if (systemPrompt) {
        return `${systemPrompt}\n\n---\n\n${userPrompt}`;
      }
      return userPrompt;
    },

    parseOutput(stdout) {
      // Buscar linea JSON con type: "result"
      // ...
    },
  },
};
```

### El spawn completo: `spawnCli()`

```javascript
function spawnCli(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      // Windows necesita shell para resolver .cmd files (claude.cmd)
      // Linux no necesita shell
      shell: process.platform === 'win32',
    });

    // CORE DEL FIX: enviar prompt via stdin
    if (options.stdinData) {
      child.stdin.write(options.stdinData);
      child.stdin.end();
    }

    // Recoger stdout, stderr, manejar idle timeout...
  });
}
```

### Diagrama de flujo: antes vs ahora

```
=== ANTES (roto en Windows) ===

runAgent()
  |
  +-- buildArgs() --> ['-p', prompt, '--system-prompt', sysPrompt, ...]
  |                    (prompt como argumento CLI)
  |
  +-- spawn('claude', args, { shell: true })
  |
  +-- cmd.exe interpreta args --> rompe quoting del prompt
  |
  +-- Claude recibe: -OmFjaFM9glBQnBTT7QQ como flag separado
  |
  X-- ERROR: "unknown option '-OmFjaFM9glBQnBTT7QQ'"


=== AHORA (funciona en todas las plataformas) ===

runAgent()
  |
  +-- buildArgs() --> ['--output-format', 'json', '--mcp-config', '...']
  |                    (solo flags seguros, sin prompts)
  |
  +-- buildStdin() --> "system prompt\n\n---\n\nuserPrompt con -OmFjaFM9glBQnBTT7QQ"
  |                    (prompt como string para stdin)
  |
  +-- spawn('claude', args, { shell: true })
  |
  +-- child.stdin.write(stdinData) --> datos directos, sin shell
  |
  +-- Claude detecta stdin pipe --> lee prompt de stdin
  |
  +-- OK: Prompt completo recibido correctamente
```

### Resumen del cambio

| Aspecto | Antes | Ahora |
|---------|-------|-------|
| Prompts como... | Argumentos CLI (`-p "..."`) | Stdin pipe (`child.stdin.write()`) |
| Pasa por shell? | Si (cmd.exe en Windows) | No (datos directos) |
| Quoting necesario? | Si (y fragil) | No |
| Funciona en Windows? | No | Si |
| Funciona en Linux? | Si | Si |
| Funciona en macOS? | Si | Si |
| Archivo modificado | `src/agents/base-agent.js` | `src/agents/base-agent.js` (reescrito) |

### Leccion aprendida

Cuando lanzas subprocesos en Node.js que necesitan recibir texto largo o complejo:

1. **Nunca pases texto largo como argumentos CLI** si vas a usar `shell: true`
2. **Usa stdin pipe** para enviar datos al proceso hijo
3. **Solo usa argumentos CLI para flags cortos y valores simples** (numeros, paths sin espacios, enums)
4. **El shell es un intermediario peligroso** -- elimina capas intermedias cuando puedas
