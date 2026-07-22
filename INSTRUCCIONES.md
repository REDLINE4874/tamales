# Dashboard de Tamales — API (Apps Script) + Web independiente

Dos proyectos separados, tal como en tus proyectos anteriores:

```
tamales-dashboard/
├── api/                     ← proyecto de Apps Script (clasp), solo backend
│   ├── src/
│   │   ├── appsscript.json
│   │   └── Codigo.gs        ← doGet / doPost devuelven JSON
│   ├── package.json
│   └── .claspignore
└── web/                     ← página web independiente (estática)
    ├── index.html
    ├── styles.css
    ├── config.js            ← aquí pegas la URL de implementación
    └── app.js                ← usa fetch() contra esa URL
```

## 1. Desplegar la API en Apps Script

```bash
cd api
npm install
npx clasp login
npx clasp create --type sheets --title "Tamales - Base de datos" --rootDir ./src
```
Si `clasp create` sobrescribe `src/appsscript.json`, vuelve a pegar el contenido original (define `access: ANYONE_ANONYMOUS`, necesario para que la web externa pueda llamarla sin login).

```bash
npm run push
npm run deploy
npm run open:webapp
```
Copia la URL que termina en `/exec` — esa es tu URL de implementación.

> Cada vez que cambies `Codigo.gs`: `npm run push` y luego `clasp deploy` de nuevo (o `clasp deploy -i <deploymentId>` para actualizar la misma implementación en vez de crear una nueva URL — revisa `npm run deployments`).

## 2. Conectar la página web

En `web/config.js`:
```js
const API_URL = "https://script.google.com/macros/s/XXXXXXX/exec";
```
Pega ahí la URL que copiaste. Nada más necesita tocarse.

## 3. Ejecutar la web

Es HTML/CSS/JS puro, sin build. Puedes:
- Abrir `web/index.html` directo en el navegador, o
- Servirla con cualquier servidor estático, por ejemplo con la extensión **Live Server** de VS Code, o `npx serve web`, o desplegarla en Netlify/Vercel/GitHub Pages.

## Cómo se comunican
- **Lecturas**: `GET {API_URL}?action=dashboard` (y similares) — sin problema de CORS.
- **Escrituras**: `POST {API_URL}` con body `JSON.stringify({ action: '...', ...datos })`, sin header `Content-Type` explícito (así el navegador manda `text/plain`, evitando el preflight de CORS que Apps Script no maneja bien). El backend igual parsea el JSON del body sin problema.

Acciones disponibles:
| Acción | Método | Payload |
|---|---|---|
| `dashboard` | GET | — |
| `config` | GET | — |
| `pedidos` | GET | `?estado=Pendiente` (opcional) |
| `crearPedido` | POST | `{ cliente, items: [{tipo, cantidad}] }` |
| `completarPedido` | POST | `{ id, montoCobrado }` |
| `reabrirPedido` | POST | `{ id }` |
| `eliminarPedido` | POST | `{ id }` |
| `guardarConfig` | POST | `{ precio, tipos: [...] }` |

## 4. Configurar tu negocio
En la hoja de cálculo (se crea sola al primer llamado a la API), pestaña **"Config"**:
- B1: precio por tamal.
- Columna A desde la fila 4: tipos de tamal que ofreces.

## 5. Acceso de tu empleado
Comparte la Hoja de Cálculo con tu empleado como **Editor** (el script escribe ahí). La página web la puede usar cualquiera con el enlace, sin necesitar login de Google, porque el acceso de la API está configurado como `ANYONE_ANONYMOUS`.

---

### Qué hace el dashboard
- **Nuevo pedido**: crea una comanda (cliente + tipos/cantidades). Se guarda como "Pendiente".
- **Pedidos activos**: tickets visuales. "Marcar pagado" pide el monto realmente cobrado y pasa a "Completado".
- **Ganancias**: gráfica semanal + totales rápidos, solo con pedidos completados.
- **Histórico**: semanas cerradas con total y detalle de cada pedido, expandible.
