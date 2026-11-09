# Arquitectura

## Vista general

```mermaid
flowchart LR
  subgraph Navegador
    P[index.html<br/>Módulo cliente]
    A[admin.html<br/>Módulo administrador]
  end
  subgraph Vercel
    S[(Archivos estáticos<br/>dist/)]
  end
  subgraph Supabase
    R[API REST<br/>PostgREST]
    AU[Auth]
    ST[Storage<br/>konys-media]
    RT[Realtime]
    DB[(PostgreSQL<br/>RLS + funciones)]
  end
  S --> P & A
  P -- "SELECT mesas/horarios/platos<br/>RPC disponibilidad, slots, crear_reserva" --> R
  A -- "CRUD + RPC resumen_dashboard" --> R
  A -- "signInWithPassword" --> AU
  A -- "subir fotos" --> ST
  R --> DB
  RT -- "cambios en vivo" --> P & A
  DB --> RT
```

- Sin backend propio: toda la lógica sensible vive en PostgreSQL (restricciones, triggers y funciones) y se protege con RLS.
- El frontend se organiza en módulos ES: `api.js` es la única capa que habla con Supabase; las vistas solo pintan y reaccionan.

## Modelo de datos

```mermaid
erDiagram
  MESAS ||--o{ RESERVAS : "recibe"
  AUTH_USERS ||--o| ADMINISTRADORES : "es"
  MESAS {
    uuid id PK
    text nombre "único, 1–40"
    text zona "salon | terraza"
    smallint capacidad "1–30"
    boolean activa
    text foto_url
    timestamptz creado_en
  }
  HORARIOS {
    uuid id PK
    smallint dia_semana "0=dom … 6=sáb"
    text jornada
    time hora_inicio
    time hora_fin "> inicio"
    smallint duracion_slot "15–240 min"
    boolean activo "sin solapes activos por día"
  }
  RESERVAS {
    uuid id PK
    uuid mesa_id FK
    text cliente_nombre
    text cliente_contacto "opcional"
    smallint num_personas
    date fecha
    time hora_inicio
    time hora_fin
    text estado "confirmada | cancelada | completada"
    timestamptz creado_en
  }
  PLATOS {
    uuid id PK
    text nombre
    text categoria "pizzas | entradas | postres | bebidas"
    text subcategoria
    text descripcion
    integer precio "COP"
    boolean disponible
    text foto_url
    smallint orden
  }
  ADMINISTRADORES {
    uuid user_id PK,FK
    text nombre
  }
```

Restricción clave contra reservas dobles:

```sql
constraint reservas_sin_solape exclude using gist (
  mesa_id with =,
  tsrange(fecha + hora_inicio, fecha + hora_fin, '[)') with &&
) where (estado <> 'cancelada')
```

## Flujo de reserva

```mermaid
sequenceDiagram
  actor C as Cliente
  participant UI as reservas.js
  participant DB as Supabase (PostgreSQL)
  C->>UI: Elige mesa
  UI->>DB: rpc slots_mesa(mesa, fecha)
  DB-->>UI: horarios (libre / ocupado / pasado)
  C->>UI: Elige hora + datos
  UI->>UI: Validación en el navegador
  UI->>DB: rpc crear_reserva(...)
  Note over DB: SELECT … FOR UPDATE (mesa)<br/>valida activa, capacidad, jornada, fecha<br/>re-verifica disponibilidad<br/>INSERT (EXCLUDE como última barrera)
  alt Disponible
    DB-->>UI: JSON de la reserva
    UI-->>C: Pantalla de confirmación
  else Ocupado / inválido
    DB-->>UI: error con HINT (HORARIO_OCUPADO…)
    UI-->>C: Mensaje claro + horarios actualizados
  end
```

## Decisiones

| Decisión | Motivo |
|---|---|
| HTML/CSS/JS sin framework | Requisito del proyecto; menos peso y cero build obligatorio. |
| Reservas solo por RPC | El público nunca escribe en tablas; todas las reglas se validan en el servidor en una transacción. |
| `EXCLUDE` + `FOR UPDATE` | Imposibilita reservas cruzadas aun con solicitudes simultáneas. |
| Vista `v_reservas` (`security_invoker`) | Une reservas con mesas respetando el RLS del administrador. |
| Tabla `administradores` | Tener una cuenta de Auth no basta para administrar. |
| Fechas en `America/Bogota` | "Hoy" y "horario pasado" se calculan igual en el servidor y en el navegador. |
| `scripts/build.mjs` | Inyecta variables de entorno en un sitio estático sin agregar dependencias. |
