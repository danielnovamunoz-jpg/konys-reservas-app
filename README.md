# Konys Pizza · Sistema de reservas de mesas

Aplicación web para **Konys Pizza** (Cra. 36 con Calle 41, barrio El Prado, Bucaramanga) que digitaliza las reservas de mesas:

- **Clientes** (sin registro): consultan las mesas y su disponibilidad real, eligen fecha y hora, reservan en segundos y ven la carta.
- **Administrador** (`/admin`, con Supabase Auth): gestiona mesas, horarios, reservas y carta, con indicadores en tiempo real.

La base de datos garantiza que **nunca** haya dos reservas cruzadas para la misma mesa, incluso si dos clientes confirman al mismo tiempo.

---

## Funcionalidades

### Página pública (`index.html`)
| Sección | Detalle |
|---|---|
| Inicio | Fotografía real de la fachada, logotipo oficial, estado **Abierto/Cerrado** calculado con los horarios de la base de datos. |
| Presentación | Información real del restaurante (pizza en kono, Pizza Master 2023, papitas al horno, eventos). |
| Nuestras mesas | Tarjetas con nombre, zona, capacidad, foto y estado (**Libre / Ocupada / Inactiva**) para la fecha elegida (hoy, mañana u otra). Filtro por zona. |
| Reserva | Modal en 3 pasos: calendario → horarios (ocupados claramente marcados) → datos (nombre, personas limitadas por capacidad, contacto opcional) → resumen → **confirmación** con código, detalles y enlace a WhatsApp. |
| Carta | Productos por categoría (Pizzas, Entradas, Postres, Bebidas) con foto, descripción, precio en COP y disponibilidad. Solo informativa. |
| Ubicación | Dirección, horarios desde la base de datos, Google Maps y "Cómo llegar". |
| Contacto | WhatsApp, Instagram, Tripadvisor y domicilios. |

Disponibilidad casi en tiempo real: Supabase Realtime + recarga cada 60 s + nueva verificación justo antes de confirmar.

### Panel administrativo (`/admin`)
| Vista | Detalle |
|---|---|
| Acceso | Correo y contraseña de **Supabase Auth**. Solo entran usuarios registrados en la tabla `administradores`. |
| Dashboard | Total de reservas, reservas del día, mesas registradas, activas y disponibles, reservas confirmadas (calculados en la base de datos), agenda del día y reservas recientes. |
| Mesas | Registrar, editar (nombre, zona, capacidad, foto), activar/desactivar (avisa si hay reservas próximas) y borrar (solo si no tiene historial). |
| Horarios | Semana completa; jornadas con hora de inicio, cierre y duración de la reserva; creación para varios días a la vez; vista previa de los turnos; activar/desactivar. |
| Reservas | Tabla con filtros por fecha, mesa y estado, periodos (próximas, hoy, anteriores, todas), paginación y cambio de estado (confirmada, cancelada, completada). |
| Carta | Crear, editar, eliminar, categoría, subcategoría, precio, descripción, foto y disponibilidad. Búsqueda. |
| Perfil | Datos de la cuenta, cambio de contraseña y cierre de sesión. |

---

## Tecnologías

- **Frontend:** HTML5, CSS3 y JavaScript moderno (módulos ES), sin frameworks ni build obligatorio.
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Realtime, API REST) mediante el SDK oficial `@supabase/supabase-js@2.118.0` (CDN jsDelivr).
- **Despliegue:** Vercel (sitio estático + script de build sin dependencias para inyectar variables de entorno).
- **Control de versiones:** Git + GitHub.
- **Pruebas:** `node:test` + PGlite (PostgreSQL real compilado a WASM) para probar el SQL sin instalar nada más.

## Estructura

```
konys-reservas-app/
├── index.html              Página pública
├── admin.html              Panel administrativo (/admin)
├── css/
│   ├── base.css            Sistema de diseño compartido (colores de marca, botones, formularios, modales)
│   ├── styles.css          Sitio público
│   ├── responsive.css      Adaptación a tablet y móvil
│   └── admin.css           Panel administrativo
├── js/
│   ├── env.example.js      Plantilla de credenciales públicas (copiar como env.js)
│   ├── config.js           Información comercial (dirección, WhatsApp, redes…)
│   ├── supabase.js         Cliente de Supabase
│   ├── api.js              Todas las consultas a la base de datos y manejo de errores
│   ├── utils.js / ui.js    Formatos (COP, fechas en hora de Bogotá), modales, notificaciones
│   ├── cliente.js          Orquestador de la página pública
│   ├── reservas.js         Mesas + flujo de reserva
│   ├── carta.js            Carta pública
│   ├── admin.js            Autenticación y enrutador del panel
│   └── admin/              Vistas: dashboard, mesas, horarios, reservas, carta, perfil
├── assets/
│   ├── images/             Fotos oficiales optimizadas (WebP) y carta
│   ├── logo/               Logotipo oficial (original y versiones sin fondo)
│   └── icons/              Favicons y sprite de íconos SVG
├── supabase/
│   ├── schema.sql          Tablas, restricciones, funciones, RLS, Storage y Realtime
│   └── seed.sql            Horarios, carta real y mesas de ejemplo
├── scripts/build.mjs       Build de Vercel (genera dist/ y js/env.js)
├── tests/                  Pruebas del SQL y servidor local que emula Supabase
├── docs/                   Arquitectura y registro de pruebas
├── vercel.json
└── .env.example
```

---

## Puesta en marcha

### 1. Crear el proyecto en Supabase
1. Entra a [supabase.com](https://supabase.com) → **New project** (región recomendada: São Paulo, la más cercana a Colombia).
2. En **Project Settings → API** copia:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** (o *publishable*) → `SUPABASE_ANON_KEY`

> La clave **anon** es pública por diseño; la seguridad la dan las políticas RLS. **Nunca** uses la clave `service_role` / `secret` en el frontend (el build la rechaza automáticamente).

### 2. Crear la base de datos
En **SQL Editor → New query**:
1. Pega y ejecuta **`supabase/schema.sql`** completo.
2. Pega y ejecuta **`supabase/seed.sql`** (horarios, carta real de Konys y 11 mesas de ejemplo).

Ambos scripts se pueden volver a ejecutar sin duplicar datos.

### 3. Configurar el acceso administrativo
1. **Authentication → Sign In / Providers → Email**: desactiva **"Allow new users to sign up"** (los administradores se crean manualmente).
2. **Authentication → Users → Add user → Create new user**: correo y contraseña del administrador (marca *Auto Confirm User*).
3. En **SQL Editor** ejecuta (cambiando el correo y el nombre):
   ```sql
   insert into public.administradores (user_id, nombre)
   select id, 'Administrador Konys' from auth.users where email = 'correo@ejemplo.com';
   ```

Un usuario de Auth que **no** esté en `administradores` no puede ver ni modificar nada.

### 4. Ejecutar en local
```bash
cp js/env.example.js js/env.js
```
Edita `js/env.js` con tu `SUPABASE_URL` y `SUPABASE_ANON_KEY` y sirve la carpeta con cualquier servidor estático:
```bash
npx serve .
```
Abre `http://localhost:3000` (público) y `http://localhost:3000/admin` (panel).

### 5. Desplegar en Vercel
1. Sube el repositorio a GitHub:
   ```bash
   git remote add origin https://github.com/TU-USUARIO/konys-reservas-app.git
   ```
   ```bash
   git push -u origin main
   ```
2. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el repositorio. `vercel.json` ya define el build (`node scripts/build.mjs`) y la carpeta de salida (`dist`).
3. En **Settings → Environment Variables** agrega `SUPABASE_URL`, `SUPABASE_ANON_KEY` y (opcional) `SUPABASE_REALTIME=true`.
4. **Deploy**. La ruta `/admin` funciona gracias a `cleanUrls`.
5. En Supabase → **Authentication → URL Configuration**, pon la URL de Vercel como *Site URL*.

---

## Probar sin credenciales (servidor local)
`tests/mock-supabase.mjs` levanta la aplicación con una API compatible con Supabase sobre **PostgreSQL real (PGlite)**, usando exactamente `schema.sql` y `seed.sql` con el RLS activo. Sirve para revisar todo el sistema antes de crear el proyecto:

```bash
cd tests && npm install && npm run mock
```
Abre `http://localhost:5173`. Las cuentas de prueba (solo locales) están en `tests/mock-users.json`. Los datos se reinician en cada arranque. Realtime no está disponible en este modo; el panel usa la recarga periódica.

## Pruebas automatizadas
```bash
cd tests && npm install && npm test
```
30 pruebas sobre el SQL real: reglas de negocio 1–7, reservas duplicadas y condición de carrera, capacidad, jornadas, fechas, seguridad RLS (anónimo, usuario no administrador, administrador), dashboard y Storage. Detalle en [`docs/pruebas.md`](docs/pruebas.md).

---

## Seguridad
- **RLS en todas las tablas.** El público solo **lee** mesas, horarios y carta; **no puede leer** reservas (datos personales) ni escribir directamente en ninguna tabla.
- Las reservas se crean **solo** con la función `crear_reserva()` (`SECURITY DEFINER`, `search_path` vacío), que valida todo en el servidor.
- Permisos administrativos basados en la tabla `administradores` (no basta con tener una cuenta).
- Storage: bucket público de solo lectura; solo administradores suben o borran fotos (JPG/PNG/WebP, máx. 5 MB, optimizadas a WebP en el navegador).
- Credenciales fuera del código (`js/env.js` ignorado por Git; en Vercel, variables de entorno).
- Encabezados de seguridad y `noindex` para `/admin` en `vercel.json`. Todo dato de la base se escapa antes de insertarlo en el HTML.

## Reglas de negocio → implementación
| # | Regla | Dónde se garantiza |
|---|---|---|
| 1 | Mesa inactiva no recibe reservas | `crear_reserva()` + trigger `tg_validar_reserva` + interfaz |
| 2 | Sin reservas simultáneas por mesa | Restricción `EXCLUDE USING gist` sobre `(mesa_id, tsrange)` + bloqueo `FOR UPDATE` |
| 3 | Personas ≤ capacidad | `crear_reserva()` + trigger + selector limitado en la interfaz |
| 4 | Solo dentro de las jornadas | `slots_del_dia()` / `crear_reserva()` (`FUERA_DE_HORARIO`) |
| 5 | Horarios ocupados no disponibles | `slots_mesa()` marca `ocupado`; la interfaz los deshabilita |
| 6 | Cancelar libera el horario | La restricción `EXCLUDE` ignora `estado = 'cancelada'` |
| 7 | Reservas permanentes | Sin política `DELETE` sobre reservas |
| 8 | Cambios admin visibles al cliente | Lectura directa de la BD + Supabase Realtime |
| 9 | Cliente sin funciones admin | RLS + `es_admin()` + verificación al iniciar sesión |
| 10 | Consultar reservas anteriores | Periodo "Anteriores"/"Todas" y filtro por fecha |
| 11 | Re-verificar antes de confirmar | `crear_reserva()` verifica y registra en una sola transacción |

---

## Recursos de la marca (fuentes)
- **Logotipo y fotografías:** recursos oficiales publicados por Konys en su página de enlaces y domicilios (`soyclubify.com/konys-pizza`, `soyclubify.com/d/konys`) e Instagram [@konys_pizza](https://www.instagram.com/konys_pizza/). Optimizados a WebP. Las versiones del logo sin fondo se derivaron del archivo oficial sin modificar las letras.
- **Colores:** naranja `#F18400` y azul `#153140` (muestreados del logotipo), azul profundo `#0C2639` (fondo de sus piezas gráficas).
- **Carta:** nombres, descripciones y precios del menú oficial de domicilios de Konys (consultado el 9 de noviembre de 2026).
- **Horarios:** documento del proyecto y biografía de Instagram ("12:30 a 2:30 & 5 a 11 p.m").

## Pendiente por confirmar con el restaurante
1. **Mesas reales:** `seed.sql` crea 11 mesas **de ejemplo** (Mesa 1–7 salón, Terraza 1–4). Ajusta nombres, zonas y capacidades desde `/admin → Mesas` y sube fotos de cada mesa.
2. **Horarios:** la página de Konys en Clubify indica *lunes a viernes 12:00 m – 2:30 p. m. y 5:00 – 10:30 p. m.; sábado y domingo hasta las 11:00 p. m.* Se cargaron los del documento (12:30–2:30 y 5:00–11:00 todos los días). Ajústalos en `/admin → Horarios` si aplica.
3. **Dirección:** Google Maps registra el local como *Carrera 36 #38-41, El Prado*; Instagram dice *Cra 36 con calle 41 esquina*. El sitio usa la segunda (editable en `js/config.js` e `index.html`); el mapa apunta a la ficha oficial de Google.
4. **Precios:** verifica que sigan vigentes antes de publicar.

## Mantenimiento
- Datos comerciales (WhatsApp, redes, dirección): `js/config.js` y textos de `index.html`.
- Días máximos de anticipación (60): `public.dias_max_anticipacion()` en `schema.sql` y `DIAS_MAX_ANTICIPACION` en `js/config.js`.
- Categorías de la carta: restricción `platos_categoria_chk` en `schema.sql` y `CATEGORIAS` en `js/config.js`.
