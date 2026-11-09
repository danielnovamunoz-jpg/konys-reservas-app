-- =============================================================================
--  KONYS PIZZA · Datos iniciales
--  Ejecutar DESPUÉS de schema.sql (SQL Editor → New query → Run).
--  Es seguro ejecutarlo varias veces: cada bloque solo inserta si la tabla
--  correspondiente está vacía.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. HORARIOS DE ATENCIÓN
--    Fuente: documento del proyecto y biografía de Instagram (@konys_pizza):
--    "12:30 a 2:30 & 5 a 11 p.m". Todos los días. Reservas de 60 minutos.
--    Se pueden ajustar desde el panel /admin → Horarios.
-- -----------------------------------------------------------------------------
insert into public.horarios (dia_semana, jornada, hora_inicio, hora_fin, duracion_slot, activo)
select d, j.jornada, j.inicio, j.fin, 60, true
from generate_series(0, 6) as d
cross join (values
  ('Almuerzo', time '12:30', time '14:30'),
  ('Noche',    time '17:00', time '23:00')
) as j (jornada, inicio, fin)
where not exists (select 1 from public.horarios);


-- -----------------------------------------------------------------------------
-- 2. CARTA
--    Fuente: menú oficial publicado por Konys en soyclubify.com/d/konys
--    (consultado el 2026-11-09). Precios en COP. Fotografías oficiales en
--    assets/images/menu/. Verifique precios vigentes antes de publicar.
-- -----------------------------------------------------------------------------
insert into public.platos (nombre, categoria, subcategoria, descripcion, precio, disponible, foto_url, orden)
select v.nombre, v.categoria, v.subcategoria, v.descripcion, v.precio, true, v.foto_url, v.orden
from (values
  -- PIZZAS · Konys de autor
  ('Bukara', 'pizzas', 'Konys de autor', 'Ganadora Pizza Master 2023. Un homenaje a la Ciudad Bonita: trozos de jugosa carne de hamburguesa y mermelada de tocineta ahumada en reducción de miel y panela, sobre nuestra salsa napolitana.', 29900, 'assets/images/menu/bukara.webp', 1),
  ('Konys Dulcinea', 'pizzas', 'Konys de autor', 'Conopizza de temporada. Pollo al horno marinado, mozzarella argentina y cremoso de tocineta ahumada caramelizada, coronado con un nacho en salsa de la casa y lluvia de parmesano.', 29900, 'assets/images/menu/dulcinea.webp', 2),
  ('Colombianísima', 'pizzas', 'Konys de autor', 'Participante Pizza Master 2022. Jugosa carne desmechada, dulces maduritos fritos y maicitos frescos, coronados con un trozo de arepa de maíz.', 29900, 'assets/images/menu/colombianisima.webp', 3),
  ('Lasagna', 'pizzas', 'Konys de autor', 'Carne molida sazonada, tocineta ahumada y queso parmesano gratinado en una cremosa salsa blanca y napolitana.', 29900, 'assets/images/menu/lasagna-kono.webp', 4),
  ('Ikónica', 'pizzas', 'Konys de autor', 'Trozos de nuggets de pollo, jamón ahumado y queso cheddar: una combinación de texturas y sabores únicos.', 29900, 'assets/images/menu/ikonica.webp', 5),
  ('Carbonara', 'pizzas', 'Konys de autor', 'Tocineta ahumada, jamón ahumado, maíz dulce y queso parmesano sobre una cremosa salsa blanca.', 29900, 'assets/images/menu/carbonara.webp', 6),
  -- PIZZAS · Konys clásicas
  ('Hawaiana', 'pizzas', 'Konys clásicas', 'Tocineta y jamón ahumados con piña OroMiel: el equilibrio perfecto entre dulce y salado.', 27900, 'assets/images/menu/hawaiana.webp', 10),
  ('Mexicana', 'pizzas', 'Konys clásicas', 'Carne molida sazonada, maíz tierno, pimentón y cebolla caramelizada, coronada con nachos crujientes y un toque de picante Tex-Mex.', 27900, 'assets/images/menu/mexicana.webp', 11),
  ('Chicken', 'pizzas', 'Konys clásicas', 'Trozos de pollo horneado y maíz tierno que resaltan el sabor de nuestra clásica salsa napolitana.', 27900, 'assets/images/menu/chicken.webp', 12),
  ('Veggie', 'pizzas', 'Konys clásicas', 'Champiñones frescos, maíz tierno, cebolla caramelizada y queso parmesano.', 27900, 'assets/images/menu/veggie.webp', 13),
  ('BBQ', 'pizzas', 'Konys clásicas', 'Pollo en salsa BBQ con un toque ranchero y cebolla caramelizada.', 27900, 'assets/images/menu/bbq.webp', 14),
  ('Teriyork', 'pizzas', 'Konys clásicas', 'Pollo jugoso, carne molida sazonada, cebolla caramelizada y pimentón fresco.', 27900, 'assets/images/menu/teriyork.webp', 15),
  -- PIZZAS · Konys ikónicas
  ('Especial', 'pizzas', 'Konys ikónicas', 'Pollo jugoso marinado, tocineta ahumada y champiñones frescos en nuestra salsa napolitana.', 29900, 'assets/images/menu/especial.webp', 20),
  ('Carnes · Auténtica Pepperoni', 'pizzas', 'Konys ikónicas', 'Pepperoni picante, cábano y jamón ahumado, para los amantes de la proteína.', 29900, 'assets/images/menu/pepperoni.webp', 21),
  ('Mar & Tierra', 'pizzas', 'Konys ikónicas', 'Camarones jugosos, pollo marinado, pimentón fresco y maíz tierno.', 30900, 'assets/images/menu/mar-tierra.webp', 22),
  ('Marinera', 'pizzas', 'Konys ikónicas', 'Camarón fresco, pulpo tierno y palmito en nuestra salsa especial de la casa.', 30900, 'assets/images/menu/marinera.webp', 23),
  ('Italianísima', 'pizzas', 'Konys ikónicas', 'Jamón serrano madurado, tomates asados y un toque de salsa pesto, con un final de queso parmesano.', 31900, 'assets/images/menu/italianisima.webp', 24),
  ('Bondiola', 'pizzas', 'Konys ikónicas', 'Bondiola de cerdo ahumada, champiñones frescos y queso parmesano sobre nuestra salsa napolitana.', 31900, 'assets/images/menu/bondiola.webp', 25),
  -- PIZZAS · Combos
  ('Combo Amigos x4', 'pizzas', 'Combos ikónicos', 'Cuatro Konys de sabores clásicos, papas fritas al horno (400 g) y cuatro granizados en dos sabores tradicionales.', 142000, 'assets/images/menu/combo-amigos-x4.webp', 30),
  ('Combo Parche x6', 'pizzas', 'Combos ikónicos', 'Seis Konys de sabores clásicos, papas fritas al horno (600 g) y seis granizados en tres sabores tradicionales.', 210000, 'assets/images/menu/combo-parche-x6.webp', 31),

  -- ENTRADAS
  ('Mini Konitos', 'entradas', 'Para compartir', 'Cinco mini Konys rellenos de queso gratinado y napolitana, en un sabor a elegir: hawaiano, pepperoni o solo queso.', 15000, 'assets/images/menu/mini-konitos.webp', 1),
  ('Nachos enchulados', 'entradas', 'Para compartir', 'Nachos crocantes con queso rallado, tártara de la casa y piña caramelizada. Perfectos para compartir.', 13000, 'assets/images/menu/nachos-enchulados.webp', 2),
  ('Papas Locas', 'entradas', 'Papas ikónicas', 'Papa francesa al horno, sin aceite, con chorizo santarrosano, salchicha llanera, carne de hamburguesa, lechuga, maicitos, salsas de la casa y queso rallado.', 39000, 'assets/images/menu/papas-locas.webp', 10),
  ('Chicken fries mini', 'entradas', 'Papas ikónicas', 'Papas al horno sin aceite, nuggets de pollo hechos en Konys, mozzarella derretida y salsas de la casa (tártara y piña).', 22000, 'assets/images/menu/chicken-fries-mini.webp', 11),
  ('Chorifries mini', 'entradas', 'Papas ikónicas', 'Papas al horno sin aceite, chorizo de cerdo artesanal, quesito costeño y salsas de la casa (tártara y piña).', 22000, 'assets/images/menu/chorifries-mini.webp', 12),
  ('Salchifries mini', 'entradas', 'Papas ikónicas', 'Papas al horno sin aceite, salchichas horneadas, quesito costeño y salsas de la casa (tártara y piña).', 22000, 'assets/images/menu/salchifries-mini.webp', 13),
  ('Porción de papas', 'entradas', 'Papas ikónicas', 'Porción de 200 g de papitas fritas sin aceite.', 7900, 'assets/images/menu/porcion-papas.webp', 14),

  -- POSTRES
  ('Copa helado clásica', 'postres', 'Copas de helado', 'Helado cookies and cream con fresa, topping de lechera, salsa de chocolate y maní.', 4900, 'assets/images/menu/copa-helado-clasica.webp', 1),
  ('Copa helado Ikónica', 'postres', 'Copas de helado', 'Doble bola de helado cookies and cream con fresa, topping de lechera, salsa de chocolate y maní.', 7900, 'assets/images/menu/copa-helado-ikonica.webp', 2),

  -- BEBIDAS · Granizados
  ('Granizado de limón', 'bebidas', 'Granizados', null, 9900, 'assets/images/menu/granizado-limon.webp', 1),
  ('Granizado de naranja', 'bebidas', 'Granizados', null, 9900, 'assets/images/menu/granizado-naranja.webp', 2),
  ('Granizado de mandarina', 'bebidas', 'Granizados', null, 9900, 'assets/images/menu/granizado-mandarina.webp', 3),
  ('Granizado de yerbabuena', 'bebidas', 'Granizados', null, 9900, 'assets/images/menu/granizado-yerbabuena.webp', 4),
  ('Granizado MaracuMango', 'bebidas', 'Granizados', null, 9900, 'assets/images/menu/granizado-maracumango.webp', 5),
  ('Cerezada', 'bebidas', 'Granizados', null, 12990, 'assets/images/menu/granizado-cerezada.webp', 6),
  ('Piña colada (sin alcohol)', 'bebidas', 'Granizados', null, 12990, 'assets/images/menu/granizado-pina-colada.webp', 7),
  ('Limonada de coco', 'bebidas', 'Granizados', null, 12990, 'assets/images/menu/limonada-coco.webp', 8),
  -- BEBIDAS · Sodas
  ('Soda Lulo Fizz', 'bebidas', 'Sodas', 'Mermelada de lulo, limón, soda, perlas explosivas de maracuyá y ginger ale.', 12900, 'assets/images/menu/soda-lulo-fizz.webp', 10),
  ('Soda de arándanos', 'bebidas', 'Sodas', 'Sirope natural de arándanos, arándanos frescos, limón, soda y perlas explosivas de cereza.', 12900, 'assets/images/menu/soda-arandanos.webp', 11),
  ('Soda de frutos rojos', 'bebidas', 'Sodas', 'Sirope natural de frutos rojos, fresa picada, limón, soda y perlas explosivas de cereza.', 12900, 'assets/images/menu/soda-frutos-rojos.webp', 12),
  ('Soda de maracuyá', 'bebidas', 'Sodas', 'Sirope natural de maracuyá, limón, soda y perlas explosivas de maracuyá.', 12900, 'assets/images/menu/soda-arandanos.webp', 13),
  -- BEBIDAS · Frías
  ('Limonada de panela', 'bebidas', 'Bebidas frías', 'Limonada de panela natural.', 7000, 'assets/images/menu/limonada-panela.webp', 20),
  ('Postobón 400 ml', 'bebidas', 'Bebidas frías', null, 6000, 'assets/images/menu/postobon.webp', 21),
  ('Coca-Cola 400 ml', 'bebidas', 'Bebidas frías', 'Original o Zero.', 6000, 'assets/images/menu/coca-cola.webp', 22),
  ('Jugo Hit 500 ml', 'bebidas', 'Bebidas frías', null, 6000, 'assets/images/menu/jugo-hit.webp', 23),
  ('Soda', 'bebidas', 'Bebidas frías', null, 6000, 'assets/images/menu/soda.webp', 24),
  ('Agua', 'bebidas', 'Bebidas frías', 'Con gas o sin gas.', 6000, 'assets/images/menu/agua.webp', 25),
  -- BEBIDAS · Cervezas
  ('Club Colombia Dorada', 'bebidas', 'Cervezas', null, 7000, 'assets/images/menu/club-colombia.webp', 30),
  ('Corona 330 ml', 'bebidas', 'Cervezas', null, 9000, 'assets/images/menu/corona.webp', 31),
  ('3 Cordilleras Rosada', 'bebidas', 'Cervezas', null, 9000, 'assets/images/menu/tres-cordilleras.webp', 32),
  ('Stella Artois', 'bebidas', 'Cervezas', null, 9000, 'assets/images/menu/stella-artois.webp', 33)
) as v (nombre, categoria, subcategoria, descripcion, precio, foto_url, orden)
where not exists (select 1 from public.platos);


-- -----------------------------------------------------------------------------
-- 3. MESAS DE EJEMPLO  ⚠ AJUSTAR A LA DISTRIBUCIÓN REAL DEL RESTAURANTE
--    La cantidad y capacidad reales de las mesas no están publicadas. Estas
--    mesas permiten probar el sistema; edítelas o desactívelas desde /admin.
-- -----------------------------------------------------------------------------
insert into public.mesas (nombre, zona, capacidad, activa)
select v.nombre, v.zona, v.capacidad, true
from (values
  ('Mesa 1', 'salon', 2),
  ('Mesa 2', 'salon', 2),
  ('Mesa 3', 'salon', 4),
  ('Mesa 4', 'salon', 4),
  ('Mesa 5', 'salon', 4),
  ('Mesa 6', 'salon', 6),
  ('Mesa 7', 'salon', 8),
  ('Terraza 1', 'terraza', 2),
  ('Terraza 2', 'terraza', 4),
  ('Terraza 3', 'terraza', 4),
  ('Terraza 4', 'terraza', 6)
) as v (nombre, zona, capacidad)
where not exists (select 1 from public.mesas);
