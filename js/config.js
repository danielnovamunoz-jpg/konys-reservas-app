// -----------------------------------------------------------------------------
// Información comercial de Konys Pizza (fuente: Instagram @konys_pizza y
// el enlace oficial soyclubify.com/konys-pizza). Centralizada para editarla
// en un solo lugar.
// -----------------------------------------------------------------------------
export const NEGOCIO = {
  nombre: 'Konys Pizza',
  eslogan: 'La pizza más ikónica de la ciudad',
  direccion: 'Cra. 36 con Calle 41, esquina',
  barrio: 'Barrio El Prado',
  ciudad: 'Bucaramanga, Santander',
  // Coordenadas publicadas por Konys en su página de domicilios (Clubify).
  coordenadas: { lat: 7.1223879, lng: -73.1099636 },
  whatsapp: '573224603184',
  whatsappVisible: '+57 322 460 3184',
  instagram: 'https://www.instagram.com/konys_pizza/',
  instagramUsuario: '@konys_pizza',
  tripadvisor: 'https://www.tripadvisor.co/Restaurant_Review-g297474-d24866358-Reviews-Konys_Pizza-Bucaramanga_Santander_Department.html',
  domicilios: 'https://soyclubify.com/d/konys',
};

export const ZONA_HORARIA = 'America/Bogota';

// Debe coincidir con public.dias_max_anticipacion() en schema.sql.
export const DIAS_MAX_ANTICIPACION = 60;

export const ZONAS = {
  salon: { nombre: 'Salón', icono: 'armchair' },
  terraza: { nombre: 'Terraza', icono: 'sun' },
};

export const CATEGORIAS = {
  pizzas: { nombre: 'Pizzas', descripcion: 'Konys de autor, clásicos e ikónicos. Todos traen papitas al horno.', portada: 'assets/images/carta/pizzas.webp' },
  entradas: { nombre: 'Entradas', descripcion: 'Para abrir el apetito y compartir en la mesa.', portada: 'assets/images/carta/entradas.webp' },
  postres: { nombre: 'Postres', descripcion: 'El final dulce de tu experiencia ikónica.', portada: 'assets/images/carta/postres.webp' },
  bebidas: { nombre: 'Bebidas', descripcion: 'Granizados, sodas de la casa, bebidas frías y cervezas.', portada: 'assets/images/carta/bebidas.webp' },
};

export const ESTADOS_RESERVA = {
  confirmada: { nombre: 'Confirmada', tono: 'success' },
  completada: { nombre: 'Completada', tono: 'info' },
  cancelada: { nombre: 'Cancelada', tono: 'danger' },
};

export const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Bucket público de Supabase Storage para fotos de mesas y platos.
export const BUCKET_MEDIA = 'konys-media';

export const ICONOS = 'assets/icons/sprite.svg';
