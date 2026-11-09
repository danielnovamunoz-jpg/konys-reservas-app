# Registro de pruebas

Fecha: 9 de noviembre de 2026.

## 1. Pruebas automatizadas de la base de datos (`tests/db.test.mjs`)
Ejecutadas sobre PostgreSQL real (PGlite) con `schema.sql` y `seed.sql` sin modificar. **Resultado: 30 de 30 pruebas aprobadas.**

| Área | Casos |
|---|---|
| Estructura | Scripts idempotentes; zona horaria de Bogotá; generación de turnos (2 de almuerzo + 6 de noche). |
| Registro | Reserva válida de un cliente anónimo; normalización del nombre. |
| Duplicados | Misma mesa y hora rechazada (`HORARIO_OCUPADO`); otra mesa a la misma hora permitida; inserciones directas que se cruzan 30 min rechazadas por `EXCLUDE`. |
| Capacidad | Más personas que la capacidad (`CAPACIDAD_EXCEDIDA`); 0 personas; trigger en inserciones directas. |
| Horarios | Mesa inactiva (`MESA_INACTIVA`); fuera de jornada o desalineado (`FUERA_DE_HORARIO`); día sin jornadas activas; fechas pasadas o a más de 60 días. |
| Datos | Nombre y contacto inválidos. |
| Disponibilidad | `slots_mesa` marca ocupados; `disponibilidad_mesas` cuenta libres y futuros. |
| Cancelación | Cancelar libera el horario; reabrir una cancelada cuyo horario ya se tomó es rechazado. |
| Seguridad | El público no lee `reservas`/`v_reservas`, no inserta directo, no modifica mesas/platos/horarios, no ejecuta funciones admin. Un usuario autenticado sin rol de administrador no ve ni modifica nada ni sube archivos. Nadie borra reservas. |
| Administración | CRUD de mesas (nombre duplicado, zona inválida, borrado bloqueado con historial); horarios sin solapes y duración que quepa; CRUD de platos; indicadores del dashboard; subida al bucket. |

## 2. Pruebas de punta a punta en el navegador
Servidor local `tests/mock-supabase.mjs` (API compatible con Supabase sobre PostgreSQL + RLS reales).

| Prueba | Resultado |
|---|---|
| Carga de la página pública (escritorio 800 px y móvil 375 px), sin errores de consola ni desbordamiento horizontal | ✔ |
| Estado "Abierto/Cerrado" calculado con los horarios de la BD | ✔ |
| Reserva completa: mesa → calendario → hora → datos → confirmación con código | ✔ |
| Validaciones del formulario (nombre vacío, personas limitadas a la capacidad) | ✔ |
| Horario reservado aparece "Ocupado" y deshabilitado | ✔ |
| Condición de carrera: otro cliente reserva el mismo horario mientras el usuario completa el formulario → mensaje claro, horario actualizado, selección limpiada | ✔ |
| Seguridad vía HTTP como anónimo: leer reservas, insertar directo, editar mesas, borrar platos, dashboard → 401 | ✔ |
| Carta por categorías con fotos, precios COP y disponibilidad | ✔ |
| Modal de reserva a pantalla completa en móvil con desplazamiento correcto | ✔ (se corrigió un error de altura) |
| Login admin: contraseña incorrecta, cuenta sin permisos rechazada, acceso correcto, sesión persistente, cierre de sesión | ✔ |
| Dashboard con indicadores reales | ✔ |
| Reservas: filtros por estado, mesa, fecha y periodo; paginación; cancelar (confirma y libera el horario para el público); reactivar con horario tomado → bloqueado | ✔ |
| Mesas: crear con foto (subida a Storage, optimizada), nombre duplicado, desactivar con aviso de reservas próximas (y el público ya no puede reservarla), borrar con/sin historial, reactivar | ✔ |
| Horarios: solape rechazado, validación de horas, creación para 2 días, edición, desactivación; cambios reflejados al instante en los turnos públicos | ✔ |
| Carta: editar precio, disponibilidad, crear y eliminar producto, búsqueda sin tildes; cambios visibles en la API pública | ✔ |
| Perfil: validación y cambio de contraseña | ✔ |
| Panel en móvil: menú lateral desplegable y tablas convertidas en tarjetas | ✔ |
| Build de Vercel: falla sin variables, rechaza claves `service_role`, genera `dist/` sin archivos internos | ✔ |

## 3. Verificación en producción
`https://konys-reservas-app.vercel.app` con el proyecto real de Supabase `konys-reservas`.

| Prueba | Resultado |
|---|---|
| `schema.sql` y `seed.sql` ejecutados; 14 horarios, 51 platos, 11 mesas, RLS en las 5 tablas, 19 políticas, bucket y 4 tablas en Realtime | ✔ |
| Registros públicos de Auth desactivados; administrador registrado; *Site URL* de producción | ✔ |
| Build de Vercel con variables de entorno (clave pública `sb_publishable_`) | ✔ |
| Página pública carga mesas, disponibilidad, carta y estado "Abierto/Cerrado" sin errores de consola | ✔ |
| **Realtime:** marcar un plato como no disponible desde la base de datos se refleja en la página abierta sin recargar | ✔ |
| Reserva completa desde la interfaz → confirmación con código | ✔ |
| Mismo horario de nuevo → `HORARIO_OCUPADO`; 12 personas en mesa de 8 → `CAPACIDAD_EXCEDIDA`; horario mostrado como `ocupado` | ✔ |
| Público intentando leer reservas o editar mesas → 401 | ✔ |
| Reserva de prueba eliminada al terminar (base en 0 reservas) | ✔ |

Pendiente: iniciar sesión en `/admin` con la cuenta del administrador (requiere su contraseña).
