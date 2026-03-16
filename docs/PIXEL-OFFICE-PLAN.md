# Komodo Pixel Office — Plan de Implementacion

> Dashboard alternativo pixel art donde cada agente de Komodo (Planner, Coder, Reviewer, Architect, Tester, Security) es un personaje animado en una oficina virtual en tiempo real.

---

## 1. Vision General

Cuando Komodo ejecuta tareas, el dashboard actual muestra una oficina 3D con robots isometricos (React Three Fiber). Este plan agrega una **vista alternativa pixel art** estilo retro donde cada agente es un muñeco 2D animado que refleja en tiempo real lo que esta haciendo: codeando, revieweando, idle, rate-limited, etc.

**Inspiracion directa:** [pixel-agents](https://github.com/pablodelucca/pixel-agents) — extension VS Code que visualiza agentes Claude Code como personajes pixel art en una oficina. Nosotros adaptamos el concepto al stack de Komodo (Next.js + WebSocket existente).

### Por que pixel art y no mejorar el 3D

- Mas ligero: Canvas 2D vs WebGL/Three.js — menos GPU, menos bateria
- Mas encantador: estetica retro genera engagement
- Complementario: el usuario elige entre 3D o pixel segun preferencia
- Mas facil de extender: agregar muebles/personajes es editar un PNG, no modelar 3D

---

## 2. Arquitectura

### 2.1 Flujo de datos (ya existente, 0 cambios)

```
Komodo Orchestrator
    |
    v
EventBus (src/events/event-bus.js)
    |
    v
KomodoWsServer (src/server/ws-server.js) ──── ws://localhost:3001
    |
    v
useKomodoSocket (dashboard/hooks/useKomodoSocket.ts)
    |
    v
useAgentStates (dashboard/hooks/useAgentStates.ts)
    |
    +──> OfficeScene3D (vista 3D actual)
    |
    +──> PixelOffice (NUEVA vista pixel art)  <── SOLO ESTO SE CREA
```

**Punto clave:** No se toca nada del backend. El pixel office es un componente frontend puro que consume los mismos hooks que ya usa la vista 3D.

### 2.2 Stack tecnologico

| Capa | Tecnologia | Justificacion |
|------|-----------|---------------|
| Renderizado | Canvas 2D nativo | Pixel-perfect, sin dependencias, ~60fps en grid pequeño |
| UI Framework | React 19 (ya instalado) | Solo para el contenedor del canvas y overlays HTML |
| Estado | useAgentStates hook (ya existe) | Reutiliza 100% la infra WebSocket existente |
| Assets | PNG spritesheets | Estandar de la industria pixel art, facil de editar |
| Build | Next.js (ya configurado) | Los assets van en `public/`, sin config extra |

### 2.3 Estructura de archivos

```
dashboard/
├── components/
│   ├── pixel/                          # NUEVO — Todo el pixel office
│   │   ├── PixelOffice.tsx             # Componente React: canvas + game loop
│   │   ├── engine/
│   │   │   ├── renderer.ts             # Pipeline renderizado por capas
│   │   │   ├── camera.ts               # Pan, zoom, follow agent
│   │   │   └── input.ts                # Click detection, hover, pan
│   │   ├── entities/
│   │   │   ├── pixel-agent.ts          # FSM + animacion + pathfinding
│   │   │   ├── furniture.ts            # Muebles estaticos/animados
│   │   │   └── speech-bubble.ts        # Bubbles de estado sobre agentes
│   │   ├── world/
│   │   │   ├── tilemap.ts              # Grid de tiles + collision map
│   │   │   ├── office-layout.ts        # Layout default de la oficina
│   │   │   └── z-sort.ts               # Ordenamiento por profundidad
│   │   ├── assets/
│   │   │   ├── sprite-loader.ts        # Carga + cache + slice de spritesheets
│   │   │   └── colorize.ts             # Recolorizar sprites por rol HSL
│   │   ├── constants.ts                # Tile size, zoom levels, timings
│   │   └── types.ts                    # Interfaces del pixel office
│   └── view-toggle.tsx                 # NUEVO — Boton 3D/Pixel en sidebar
├── public/
│   └── assets/
│       └── pixel/                      # NUEVO — Assets pixel art
│           ├── characters/
│           │   ├── planner.png         # Spritesheet 112x96
│           │   ├── coder.png
│           │   ├── reviewer.png
│           │   ├── architect.png
│           │   ├── tester.png
│           │   ├── security.png
│           │   └── komodo-boss.png     # Mascota lagarto
│           ├── furniture/
│           │   ├── desk.png
│           │   ├── chair.png
│           │   ├── monitor-on.png
│           │   ├── monitor-off.png
│           │   ├── whiteboard.png
│           │   ├── coffee-machine.png
│           │   ├── sofa.png
│           │   ├── plant.png
│           │   └── bookshelf.png
│           ├── tiles/
│           │   ├── floor-wood.png      # 16x16
│           │   ├── floor-carpet.png
│           │   ├── floor-tile.png
│           │   └── walls.png           # 4x4 auto-tile grid (16x32 cada pieza)
│           └── ui/
│               ├── bubble-talk.png
│               ├── bubble-alert.png
│               ├── bubble-wait.png
│               └── icons.png           # Status icons spritesheet
```

---

## 3. Requisitos Funcionales

### RF-01: Renderizado de oficina pixel art
- Dibujar oficina isometrica top-down en Canvas 2D
- Grid base de 24x18 tiles (16x16 px cada tile)
- Capas de render: floor → walls → furniture (back) → agents → furniture (front) → overlays
- Z-sorting por posicion Y para profundidad correcta
- Zoom integer 1x a 4x (sin interpolacion, pixel-perfect)
- Pan con click-drag o middle-mouse

### RF-02: Agentes como personajes animados
- 6 personajes unicos, uno por rol, con colores distintivos:

| Agente | Color primario | Color acento | Icono |
|--------|---------------|-------------|-------|
| PLANNER | Azul (#3B82F6) | Blanco | 📋 |
| CODER | Verde (#22C55E) | Negro | </> |
| REVIEWER | Naranja (#F97316) | Blanco | ✓ |
| ARCHITECT | Morado (#A855F7) | Gris | ⚙ |
| TESTER | Rojo (#EF4444) | Blanco | 🐛 |
| SECURITY | Gris (#6B7280) | Cyan | 🛡 |

- Cada personaje tiene spritesheet con:
  - 4 direcciones (down, up, right; left = mirror de right)
  - 3 estados animados: idle (2 frames), walk (4 frames), work/type (4 frames)
  - Frame rate: 8 FPS para animaciones

### RF-03: State machine de agentes
- Mapeo de estado Komodo → estado visual pixel:

```
Estado Komodo              →  Estado Pixel    →  Comportamiento visual
─────────────────────────────────────────────────────────────────────
agent.status = 'idle'      →  IDLE            →  Parado en zona comun, animacion idle
agent.status = 'working'   →  WALK → SIT_WORK →  Camina a su desk, se sienta, teclea
agent.status = 'done'      →  CELEBRATE → IDLE →  Efecto check verde, vuelve a idle
agent.status = 'walking'   →  WALKING         →  Caminando entre puntos
phase = 'planning'         →  WHITEBOARD      →  Planner va a la pizarra
phase = 'reviewing'        →  SIT_READ        →  Reviewer sentado leyendo
rate-limited               →  COFFEE          →  Va al sofa/cafetera con bubble "..."
error                      →  ALERT           →  Bubble "!" rojo, se detiene
spawn                      →  SPAWN           →  Efecto matrix digital rain (0.3s)
despawn                    →  DESPAWN          →  Efecto matrix inverso (0.3s)
```

### RF-04: Pathfinding
- BFS en grid de tiles
- Collision map: paredes y muebles bloquean paso
- Waypoints predefinidos: desk de cada agente, whiteboard, zona cafe, zona idle
- Velocidad de caminata: 2 tiles/segundo

### RF-05: Overlays informativos
- Speech bubble sobre agente activo con texto corto:
  - "Coding task-42..." / "Reviewing PR #15" / "Planning..." / "Rate limited..."
- Mini progress indicator (opcional): barra pixel sobre el desk
- Status dot: verde (available), amarillo (rate-limited), rojo (error) — esquina del personaje

### RF-06: Interactividad
- Click en agente → selecciona, camara lo sigue, panel lateral muestra:
  - Nombre del agente y rol
  - Estado actual y tarea
  - CLI health (available/rate-limited/down)
  - Logs recientes (del hook useKomodoSocket.agentLogs)
- Click en area vacia → deselecciona
- Hover sobre agente → tooltip con nombre y estado

### RF-07: Toggle de vista
- Boton en sidebar: icono de toggle "3D / Pixel"
- Preferencia persiste en localStorage
- Transicion suave (fade out → fade in)
- Ambas vistas consumen los mismos datos, sin duplicar conexiones WS

### RF-08: Komodo Boss
- Personaje especial: lagarto pixel art en escritorio central/elevado
- Siempre presente, no mapea a ningun agente real
- Animacion idle: parpadea, mueve la cola
- Cuando hay actividad: mira hacia el agente que esta trabajando

### RF-09: Efectos ambientales
- Monitores de escritorios encendidos/apagados segun agente activo
- Planta se mueve levemente (2 frames idle)
- Reloj en pared avanza (opcional)
- Particulas de cafe en cafetera cuando agente rate-limited esta ahi

---

## 4. Requisitos No Funcionales

### RNF-01: Performance
- **Target: 60 FPS estables** en grid 24x18 con 6 agentes
- Canvas size maximo: 384x288 px nativo (escalado por zoom CSS, no ctx.scale)
- Sprite cache: cargar todos los sprites al inicio, mantener en memoria como ImageBitmap
- Dirty rectangles (opcional): solo redibujar tiles que cambiaron
- RAF throttle: si tab no visible, bajar a 1 FPS

### RNF-02: Memoria
- Presupuesto: < 20 MB para todos los assets pixel
- Spritesheets compactos: maximo 256x256 px por sheet
- No duplicar sprites en memoria — cache compartido

### RNF-03: Compatibilidad
- Browsers: Chrome 90+, Firefox 90+, Edge 90+
- Canvas 2D es universal, sin WebGL requerido
- Responsive: canvas se escala al contenedor padre
- Dark mode compatible (el pixel art tiene su propia paleta)

### RNF-04: Mantenibilidad
- Assets separados del codigo — agregar mueble = agregar PNG + entry en layout
- Layout de oficina en JSON puro — editable sin tocar codigo
- Constantes centralizadas en `constants.ts`
- Tipos estrictos en `types.ts`

---

## 5. Diseño del Layout de Oficina

```
 0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22 23
┌──────────────────────────────────────────────────────────────────────────┐
│ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██│ 0  PARED NORTE
│ ██ 🪟 🪟 🪟 ██ 🪟 🪟 🪟 ██ 🪟 🪟 🪟 ██ 🪟 🪟 🪟 ██ 🪟 🪟 🪟 ██ ██│ 1  VENTANAS
│ ██                            [WHITEBOARD]            📚 📚          ██│ 2  ZONA PLANNER
│ ██    ┌PLANNER─┐  ┌ARCHIT──┐                         📚 📚          ██│ 3
│ ██    │🖥️  💺 │  │🖥️  💺 │                                        ██│ 4  FILA DESKS 1
│ ██    └────────┘  └────────┘                                        ██│ 5
│ ██                                              ┌──KOMODO──┐        ██│ 6
│ ██    ┌CODER───┐  ┌CODER-2─┐                    │ 🦎 🖥️   │        ██│ 7  FILA DESKS 2
│ ██    │🖥️  💺 │  │🖥️  💺 │                    │   BOSS   │        ██│ 8
│ ██    └────────┘  └────────┘                    └──────────┘        ██│ 9
│ ██                                                                  ██│10
│ ██    ┌REVIEWER┐  ┌TESTER──┐  ┌SECURITY┐                           ██│11  FILA DESKS 3
│ ██    │🖥️  💺 │  │🖥️  💺 │  │🖥️  💺 │                           ██│12
│ ██    └────────┘  └────────┘  └────────┘                           ██│13
│ ██                                                                  ██│14
│ ██    🪴         [SOFA]  [SOFA]     ☕            🪴               ██│15  ZONA RELAX
│ ██                                 [COFFEE]                         ██│16
│ ██ ██ ██ ██ ██ ██ ██ ██ ██ [DOOR] ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██│17  PARED SUR
└──────────────────────────────────────────────────────────────────────────┘

LEYENDA:
██ = Pared            🖥️ = Monitor          💺 = Silla
🪟 = Ventana          📚 = Libreria          🪴 = Planta
☕ = Cafetera          🦎 = Komodo Boss       [DOOR] = Puerta
```

### Zonas funcionales

| Zona | Tiles | Proposito |
|------|-------|-----------|
| Desks fila 1 | (2-5, 3-5) y (7-10, 3-5) | PLANNER y ARCHITECT |
| Desks fila 2 | (2-5, 7-9) y (7-10, 7-9) | CODER y CODER-2 (si hay sub-agente) |
| Desks fila 3 | (2-5, 11-13), (7-10, 11-13), (12-15, 11-13) | REVIEWER, TESTER, SECURITY |
| Whiteboard | (10-14, 2) | PLANNER va aqui en fase planning |
| Zona relax | (4-12, 15-16) | Agentes rate-limited van al sofa/cafe |
| Zona idle | Pasillos centrales | Agentes idle deambulan por aqui |
| Komodo Boss | (17-20, 6-9) | Escritorio especial del jefe lagarto |

---

## 6. Especificacion de Sprites

### 6.1 Formato de spritesheet por personaje

```
Dimensiones: 112 x 96 px (7 columnas x 3 filas)
Cada frame: 16 x 32 px

Columnas (frames):
  0: walk-1    1: walk-2 (idle)    2: walk-3    3: walk-4
  4: type-1    5: type-2           6: read-1

Filas (direcciones):
  0: Down (frente)
  1: Up (espalda)
  2: Right (lado) — Left se genera con mirror horizontal
```

### 6.2 Animaciones

| Estado | Frames | Secuencia | FPS |
|--------|--------|-----------|-----|
| Idle | 2 | [1, 0] loop | 4 |
| Walk | 4 | [0, 1, 2, 3] loop | 8 |
| Type/Work | 2 | [4, 5] loop | 6 |
| Read/Review | 1 | [6] static | — |
| Sit idle | 1 | [1] static + offset Y -6px | — |

### 6.3 Tiles

| Asset | Dimensiones | Detalle |
|-------|------------|---------|
| Floor tile | 16x16 px | 3 variantes: madera, alfombra, azulejo |
| Wall tile | 16x32 px | Auto-tiling 4-bit bitmask (16 piezas en grid 4x4) |
| Furniture | Variable, multiplo de 16 | Cada mueble tiene footprint en tiles para collision |

---

## 7. Motor de Renderizado

### 7.1 Game loop

```typescript
// Pseudocodigo del loop principal
function gameLoop(timestamp: number) {
  const delta = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  // 1. Update
  updateAgents(delta);          // FSM transitions, pathfinding, animation frame
  updateFurniture(delta);       // Monitor on/off, plant sway
  updateCamera(delta);          // Smooth follow selected agent
  updateBubbles(delta);         // Fade timers

  // 2. Render
  clearCanvas();
  renderFloor(camera);          // Tiles de piso
  renderWalls(camera);          // Paredes con auto-tiling
  renderEntities(camera);       // Z-sorted: furniture + agents mezclados por Y
  renderOverlays(camera);       // Bubbles, tooltips, selection highlight

  requestAnimationFrame(gameLoop);
}
```

### 7.2 Z-Sorting

Todas las entidades (agentes + muebles) se ordenan por su `y + height` antes de dibujar. Esto asegura que un agente detras de un escritorio se dibuje antes que el escritorio, creando profundidad correcta.

```typescript
const entities = [...agents, ...furniture];
entities.sort((a, b) => (a.y + a.sortOffset) - (b.y + b.sortOffset));
entities.forEach(e => e.render(ctx, camera));
```

### 7.3 Camera system

```typescript
interface Camera {
  x: number;           // World position
  y: number;
  zoom: 1 | 2 | 3 | 4; // Integer only — pixel perfect
  followTarget: string | null;  // Agent ID or null
}
```

- Zoom con scroll wheel (solo valores enteros 1-4)
- Pan con middle-click drag
- Follow: camara centra suavemente en agente seleccionado (lerp)
- Bounds: no permitir scroll fuera del mapa

---

## 8. Integracion con Komodo

### 8.1 Hook de consumo (ya existente)

```typescript
// En PixelOffice.tsx — consume los hooks que YA existen
const { snapshot, connected, agentLogs, cliHealth } = useKomodoSocket();
const { agents, phase } = useAgentStates(snapshot, connected);

// agents = {
//   PLANNER: { status: 'working', activity: 'Planning tasks...', ... },
//   CODER: { status: 'idle', activity: null, ... },
//   ...
// }
```

### 8.2 Mapeo estado → comportamiento visual

```typescript
function mapAgentToPixelState(agent: AgentVisualState, phase: Phase): PixelAgentState {
  // Rate limited → va al sofa
  if (agent.status === 'rate-limited') return 'COFFEE_BREAK';

  // Error → alerta
  if (agent.status === 'error') return 'ALERT';

  // Done → celebra brevemente
  if (agent.status === 'done') return 'CELEBRATE';

  // Working → depende del rol
  if (agent.status === 'working') {
    if (agent.name === 'PLANNER' && phase === 'planning') return 'WHITEBOARD';
    if (agent.name === 'REVIEWER') return 'READING';
    return 'TYPING';
  }

  // Idle → deambula
  return 'IDLE_WANDER';
}
```

### 8.3 Eventos especiales

| Evento WS | Efecto visual pixel |
|-----------|-------------------|
| `agent:state-change` → working | Agente camina a su desk, se sienta, empieza a teclear |
| `agent:state-change` → idle | Agente se para, camina a zona idle |
| `task:completed` | Check verde sobre agente, sonido 8-bit (opcional) |
| `pr:created` | Documento aparece flotando del coder al reviewer |
| `review:cycle:start` | Reviewer camina a su desk con animacion de lectura |
| `agent:rate-limit` | Agente camina al sofa, bubble "zzz" o "..." |
| `cli:recovered` | Agente se despierta del sofa, camina a su desk |
| `sonar:analysis:start` | Scanner animado aparece sobre area central |
| `phase:change` | Luces de oficina cambian de color segun fase |

---

## 9. Plan de Ejecucion por Sprints

### Sprint 1: Assets y Fundacion
**Objetivo:** Tener los sprites y el canvas basico renderizando

- [ ] Conseguir/crear spritesheets de 6 personajes + komodo boss
- [ ] Crear tiles de piso (3 variantes) y paredes (auto-tile set)
- [ ] Crear sprites de muebles (desk, chair, monitor, whiteboard, sofa, coffee, plant)
- [ ] Crear `constants.ts` y `types.ts`
- [ ] Crear `sprite-loader.ts` — carga PNGs, slice por frame, cache como ImageBitmap
- [ ] Crear `PixelOffice.tsx` — canvas basico que renderiza un grid de tiles de piso
- [ ] **Entregable:** Canvas con piso de oficina y sprites de muebles estaticos

### Sprint 2: Agentes y Animacion
**Objetivo:** Personajes animados moviéndose en la oficina

- [ ] Crear `pixel-agent.ts` — FSM con estados: IDLE, WALK, SIT, TYPE, READ, COFFEE
- [ ] Implementar animacion por frames (cycle through spritesheet)
- [ ] Implementar pathfinding BFS en el grid
- [ ] Posicionar 6 agentes en sus desks asignados
- [ ] Conectar con `useAgentStates` — cuando estado cambia, agente reacciona
- [ ] **Entregable:** Agentes que caminan a su desk cuando "working" y vuelven cuando "idle"

### Sprint 3: Renderer Completo y Camera
**Objetivo:** Render pipeline profesional con Z-sorting y camera

- [ ] Crear `renderer.ts` — pipeline de capas (floor → walls → entities z-sorted → overlays)
- [ ] Crear `camera.ts` — zoom 1x-4x, pan, follow agent
- [ ] Crear `input.ts` — click detection, hover, mouse events
- [ ] Implementar Z-sorting correcto de agentes + muebles
- [ ] Auto-tiling de paredes (4-bit bitmask)
- [ ] **Entregable:** Oficina completa con zoom, pan, y profundidad correcta

### Sprint 4: UI Overlays e Interactividad
**Objetivo:** Bubbles, tooltips, seleccion de agentes

- [ ] Crear `speech-bubble.ts` — bubbles de texto/estado sobre agentes
- [ ] Click en agente → selecciona, muestra panel de detalle (HTML overlay, no canvas)
- [ ] Hover → tooltip con nombre y estado
- [ ] Status dots (verde/amarillo/rojo) en esquina de personaje
- [ ] Monitores se encienden/apagan segun agente activo
- [ ] **Entregable:** Dashboard interactivo con informacion contextual

### Sprint 5: Integracion y Toggle
**Objetivo:** Integrar con dashboard existente, toggle 3D/Pixel

- [ ] Crear `view-toggle.tsx` en sidebar
- [ ] Modificar `page.tsx` para renderizar condicional 3D o Pixel
- [ ] Persistir preferencia en localStorage
- [ ] Transicion fade entre vistas
- [ ] Verificar que ambas vistas no crean conexiones WS duplicadas
- [ ] **Entregable:** Toggle funcional entre vista 3D y pixel

### Sprint 6: Polish y Efectos
**Objetivo:** Detalles que hacen la diferencia

- [ ] Efecto spawn/despawn matrix (digital rain 0.3s)
- [ ] Komodo Boss: idle animation, mira hacia agente activo
- [ ] Sonidos 8-bit opcionales (task complete, agent spawn) via Web Audio API
- [ ] Cambio de iluminacion de oficina segun fase (planning=azul, coding=verde, etc.)
- [ ] Particulas de cafe en cafetera
- [ ] Animacion de documento volando del coder al reviewer en PR created
- [ ] Performance: throttle RAF cuando tab no visible
- [ ] **Entregable:** Experiencia pulida lista para produccion

---

## 10. Dependencias y Requisitos Previos

### 10.1 Dependencias NPM (nuevas)

**Ninguna.** Canvas 2D es nativo del browser. No se necesitan librerias adicionales.

Toda la funcionalidad se construye con:
- `CanvasRenderingContext2D` (nativo)
- `requestAnimationFrame` (nativo)
- `Image` / `createImageBitmap` (nativo)
- `AudioContext` (nativo, para sonidos opcionales)
- React hooks (ya instalado)

### 10.2 Assets necesarios

| Asset | Formato | Cantidad | Fuente sugerida |
|-------|---------|----------|----------------|
| Character spritesheets | PNG 112x96 | 7 (6 agentes + boss) | Crear custom o adaptar de itch.io |
| Floor tiles | PNG 16x16 | 3 variantes | Crear custom |
| Wall tileset | PNG 64x128 (4x4 grid) | 1 | Crear custom |
| Furniture sprites | PNG variable | ~10 piezas | Crear custom o adaptar |
| UI sprites | PNG variable | ~5 piezas | Crear custom |

**Opcion para assets:**
1. **Pack comercial:** [JIK-A-4 Metro City](https://jik-a-4.itch.io/) (~$10, mismo que pixel-agents usa)
2. **Generacion IA:** DALL-E / Midjourney para generar sprites base, limpiar en Aseprite
3. **Open source:** itch.io tiene packs gratuitos CC0/MIT para oficina pixel art
4. **Custom:** Dibujar en Aseprite/Piskel (mas tiempo pero resultado exacto)

### 10.3 Herramientas de desarrollo

| Herramienta | Uso | Obligatorio |
|-------------|-----|-------------|
| Aseprite / Piskel | Editar/crear sprites | Si (cualquiera de los dos) |
| Browser DevTools | Debug canvas, performance profiling | Si |
| Next.js dev server | `npm run dev` en dashboard/ | Ya existe |

---

## 11. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion |
|--------|-------------|---------|-----------|
| Assets pixel art toman mucho tiempo | Alta | Medio | Empezar con placeholders (rectangulos de color), iterar sprites despues |
| Performance en grids grandes | Baja | Alto | Grid fijo 24x18, dirty rect rendering, throttle cuando tab oculta |
| Canvas click detection imprecisa | Media | Bajo | Hit-test por tile coordinates, no pixel — facil y preciso |
| Z-sorting con bugs visuales | Media | Bajo | Sort por (y + sortOffset), bien testeado en pixel-agents |
| Conflicto con vista 3D | Baja | Medio | Render condicional, solo una vista activa a la vez, mismo hook de datos |
| Sprites se ven borrosos en zoom | Baja | Medio | `image-rendering: pixelated` en CSS + zoom solo por enteros |

---

## 12. Criterios de Aceptacion

### Minimo viable (Sprints 1-3)
- [ ] Oficina pixel art visible con tiles, paredes y muebles
- [ ] 6 agentes posicionados en sus desks
- [ ] Agentes caminan a su desk cuando estado = working
- [ ] Agentes vuelven a zona idle cuando estado = idle
- [ ] Animaciones de walk y type funcionando
- [ ] Zoom y pan funcional

### Feature complete (Sprints 4-5)
- [ ] Speech bubbles con estado actual del agente
- [ ] Click en agente muestra panel de detalle
- [ ] Toggle 3D/Pixel funcional en sidebar
- [ ] Datos en tiempo real via WebSocket existente

### Polish (Sprint 6)
- [ ] Efectos spawn/despawn
- [ ] Komodo Boss animado
- [ ] Sonidos opcionales
- [ ] Cambio de iluminacion por fase
- [ ] 60 FPS estables

---

## 13. Metricas de Exito

| Metrica | Target |
|---------|--------|
| FPS | >= 58 FPS sostenido |
| Memoria | < 20 MB assets cargados |
| Tiempo carga inicial | < 500ms |
| Archivos nuevos | < 15 |
| Lineas de codigo nuevas | < 2500 |
| Dependencias NPM nuevas | 0 |
| Cambios al backend | 0 |

---

## 14. Referencias

- [pixel-agents](https://github.com/pablodelucca/pixel-agents) — Inspiracion directa, VS Code extension
- [pixel-agents CLAUDE.md](https://github.com/pablodelucca/pixel-agents/blob/main/CLAUDE.md) — Arquitectura tecnica detallada
- Komodo dashboard actual: `dashboard/components/3d/` — Vista 3D existente
- Komodo WebSocket: `src/server/ws-server.js` + `dashboard/hooks/useKomodoSocket.ts`
- Komodo agent states: `dashboard/hooks/useAgentStates.ts`
