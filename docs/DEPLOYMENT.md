# Despliegue de Komodo Dashboard

Guia para desplegar el dashboard de Komodo en un servidor Ubuntu Server con Cloudflare Tunnel.

## Arquitectura

```
Tu PC (desarrollo)                    Ubuntu Server                     Internet
+-----------------+                  +----------------------+          +------------------+
| Komodo CLI/MCP  | --- eventos ---> | WS Server (:3001)    | <-----  | ws.tudominio.com |
|                 |                  | Dashboard (:3000)    | <-----  | tudominio.com    |
+-----------------+                  +----------------------+          +------------------+
                                            ^                                |
                                            |    Cloudflare Tunnel           |
                                            +--------------------------------+
```

**Componentes:**
- **WS Server** (`npm run ws-server`): Servidor WebSocket standalone en puerto **4681** que recibe eventos y los retransmite al dashboard
- **Dashboard** (`npm run dashboard`): App Next.js en puerto **4680** que se conecta al WS server y muestra la oficina animada
- **Cloudflare Tunnel**: Tunel seguro que expone los puertos locales del servidor a tu dominio sin abrir puertos

## Requisitos en el servidor

- Ubuntu Server 20.04+ (o cualquier distro Linux)
- Node.js 18+ (`sudo apt install nodejs npm` o via nvm)
- PM2 para mantener procesos vivos (`npm install -g pm2`)
- Git para clonar el repo
- Un dominio en Cloudflare (gratis)

## Paso 1: Preparar el servidor

```bash
# Conectar al servidor
ssh usuario@tu-servidor-ip

# Instalar Node.js 20 (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Instalar PM2 globalmente
sudo npm install -g pm2

# Instalar Git (si no lo tienes)
sudo apt install -y git
```

## Paso 2: Clonar y configurar Komodo

```bash
# Clonar el repositorio
cd /opt
sudo git clone https://github.com/SergioRVDev/komodo.git
sudo chown -R $USER:$USER /opt/komodo

# Instalar dependencias
cd /opt/komodo
npm install

# Instalar dependencias del dashboard
cd /opt/komodo/dashboard
npm install

# Volver a la raiz
cd /opt/komodo

# Copiar y editar el .env
cp .env.example .env
nano .env
# Configurar: DEFAULT_PROJECT_ID, FIREBASE keys, GITHUB_TOKEN, etc.
```

## Paso 3: Configurar variables de entorno del Dashboard

```bash
# Crear .env.local en el dashboard
nano /opt/komodo/dashboard/.env.local
```

Contenido:
```env
# URL del WebSocket server (para el cliente del navegador)
NEXT_PUBLIC_WS_URL=wss://ws.komodo.tudominio.com

# Firebase (si el dashboard accede directamente)
FIREBASE_DATABASE_URL=https://tu-proyecto.firebaseio.com
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
```

## Paso 4: Build del Dashboard

```bash
cd /opt/komodo/dashboard
npm run build
```

Esto genera la version optimizada de produccion en `.next/`.

## Paso 5: Lanzar con PM2

```bash
cd /opt/komodo

# Lanzar el WS Server (puerto 3001)
pm2 start src/server/ws-server-standalone.js --name komodo-ws

# Lanzar el Dashboard (puerto 3000)
pm2 start npm --name komodo-dashboard -- run dashboard --prefix /opt/komodo/dashboard

# Verificar que estan corriendo
pm2 status

# Guardar la configuracion para que sobreviva reinicios
pm2 save
pm2 startup
# Ejecutar el comando que te muestra pm2 startup (copia y pega)
```

**Comandos utiles de PM2:**
```bash
pm2 status              # Ver estado de los procesos
pm2 logs komodo-ws      # Ver logs del WS server
pm2 logs komodo-dashboard  # Ver logs del dashboard
pm2 restart all         # Reiniciar todo
pm2 stop komodo-ws      # Parar el WS server
pm2 monit               # Monitor en tiempo real (CPU, RAM)
```

## Paso 6: Instalar Cloudflare Tunnel

Cloudflare Tunnel crea un tunel seguro entre tu servidor y Cloudflare. **No necesitas abrir puertos** en el firewall ni configurar SSL manualmente. Cloudflare se encarga de todo.

```bash
# Instalar cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
rm cloudflared.deb

# Autenticarse con Cloudflare
cloudflared tunnel login
# Se abre un enlace en el navegador - selecciona tu dominio

# Crear el tunnel
cloudflared tunnel create komodo
# Apunta el ID del tunnel que te devuelve (ej: a1b2c3d4-...)
```

## Paso 7: Configurar el Tunnel

```bash
# Crear el archivo de configuracion
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

Contenido de `config.yml`:
```yaml
tunnel: TU_TUNNEL_ID
credentials-file: /home/tu-usuario/.cloudflared/TU_TUNNEL_ID.json

ingress:
  # Dashboard (Next.js)
  - hostname: komodo.tudominio.com
    service: http://localhost:4680

  # WebSocket Server
  - hostname: ws.komodo.tudominio.com
    service: http://localhost:4681

  # Catch-all (obligatorio)
  - service: http_status:404
```

## Paso 8: Crear registros DNS en Cloudflare

```bash
# Crear los registros CNAME automaticamente
cloudflared tunnel route dns komodo komodo.tudominio.com
cloudflared tunnel route dns komodo ws.komodo.tudominio.com
```

Esto crea registros CNAME en tu zona DNS de Cloudflare apuntando al tunnel.

## Paso 9: Ejecutar el Tunnel con PM2

```bash
# Lanzar el tunnel con PM2 (para que sea persistente)
pm2 start cloudflared --name komodo-tunnel -- tunnel run komodo

# Guardar
pm2 save
```

## Paso 10: Verificar

```bash
# Ver que todo esta corriendo
pm2 status
# Deberias ver 3 procesos: komodo-ws, komodo-dashboard, komodo-tunnel

# Probar el WS server
curl https://ws.komodo.tudominio.com/api/state
# Deberia devolver el JSON del estado

# Abrir el dashboard en el navegador
# https://komodo.tudominio.com
```

## Resumen de puertos y servicios

| Servicio | Puerto local | Dominio publico | Proceso PM2 |
|----------|-------------|-----------------|-------------|
| Dashboard (Next.js) | 4680 | komodo.tudominio.com | komodo-dashboard |
| WS Server | 4681 | ws.komodo.tudominio.com | komodo-ws |
| Cloudflare Tunnel | - | - | komodo-tunnel |

## Actualizaciones

Cuando hagas cambios en el codigo:

```bash
cd /opt/komodo
git pull origin main

# Si cambiaste el backend (WS server)
pm2 restart komodo-ws

# Si cambiaste el dashboard
cd dashboard
npm run build
pm2 restart komodo-dashboard
```

## Troubleshooting

### El dashboard no conecta al WebSocket
- Verifica que `NEXT_PUBLIC_WS_URL` apunta a `wss://ws.komodo.tudominio.com`
- Revisa logs: `pm2 logs komodo-ws`
- Prueba el endpoint: `curl https://ws.komodo.tudominio.com/api/state`

### Cloudflare Tunnel no conecta
- Revisa logs: `pm2 logs komodo-tunnel`
- Verifica credenciales: `ls ~/.cloudflared/`
- Recrea el tunnel: `cloudflared tunnel delete komodo && cloudflared tunnel create komodo`

### PM2 no arranca al reiniciar el servidor
```bash
pm2 save
pm2 startup
# Copia y ejecuta el comando que te muestra
```

### Errores de permisos
```bash
sudo chown -R $USER:$USER /opt/komodo
```

## Costes

| Servicio | Coste |
|----------|-------|
| Cloudflare Tunnel | Gratis |
| Cloudflare DNS | Gratis |
| SSL/HTTPS | Gratis (Cloudflare lo gestiona) |
| Ubuntu Server | Lo que ya pagas por el VPS |
| **Total extra** | **0 EUR/mes** |
