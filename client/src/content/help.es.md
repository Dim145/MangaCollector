# Ayuda

Todo lo que hace la aplicación, explicado una vez. Los glifos japoneses
que sirven de marcas visuales están en el [glosario](/glossary).

## Añadir una serie

Desde **Añadir**, busca por título: los resultados vienen de
MyAnimeList, con MangaDex de reserva. Una serie llega con su número de
tomos, su portada y sus géneros.

- Una serie que no está en ninguno de los dos catálogos se crea a mano,
  con tu propio título y tu propio número de tomos.
- El botón **escanear** de la cabecera lee un código de barras y te
  lleva directamente al sitio correcto.
- La importación desde MyAnimeList, AniList, MangaDex o un CSV de
  Yamtrack está en los ajustes.

## Los tomos

Cada serie tiene su página, y cada tomo su estado. Un clic en una casilla
marca el tomo como adquirido; el lápiz abre el cajón de detalle.

- **Adquirido** y **leído** son independientes: puedes tener un tomo sin
  haberlo leído, y al revés.
- El precio y la tienda alimentan las cifras de gasto.
- La edición **coleccionista** lleva el sello 限.
- Un **estuche** agrupa varios tomos bajo un solo precio.

## El ejemplar físico

El cajón de un tomo describe el objeto, no la obra.

- **Estado**: nuevo, como nuevo, bueno, aceptable, desgastado.
- **Dónde vive**: texto libre. Se sugieren los nombres ya usados.
- **Copias extra**: cuántas además de la primera. Un sello ×N aparece en
  la casilla del tomo.
- **Comprado el** e **ISBN**: la fecha de compra y el código del lomo.

## Préstamos

Prestar un tomo se hace desde su cajón. El tomo sigue siendo tuyo,
simplemente está en otro sitio.

- Un préstamo puede apuntar a un **amigo** de la aplicación, y su lado
  ve entonces el tomo entre lo que tiene prestado.
- Una **fecha de devolución** opcional deja el préstamo atrasado cuando
  pasa; el contador de la navegación lo señala.
- El **registro** guarda todos los préstamos hechos, devoluciones
  incluidas, y se exporta en CSV.

## El escáner

El escáner funciona entero en el navegador: ninguna imagen sale del
dispositivo.

- Un código que ya está en tu estantería abre la serie, propone contar
  una copia más, o pasa al siguiente.
- Un código desconocido va al flujo de alta, con el título ya relleno
  cuando un catálogo lo conoce.
- Sin cámara, o con la cámara denegada: **una foto** o **teclear el
  número** siguen exactamente el mismo camino.
- En un lomo oscuro, la **linterna** y el **zoom** aparecen cuando el
  dispositivo sabe hacerlos.

## Almacenaje e inventario

- **Almacenaje** lista los lugares y lo que guardan. Los tomos se mueven
  por selección, o escaneando sus lomos.
- **Inventario** cuenta una estantería: escanea los lomos uno a uno, lo
  que nunca se escaneó es lo que falta. Los tomos prestados van aparte.
- Ambos pueden imprimir una **hoja de etiquetas** con el código de
  barras de cada tomo.

## Sin conexión

La aplicación guarda una copia local de la colección y funciona sin red.

- Una modificación hecha sin conexión se guarda al momento y llega al
  servidor cuando vuelve la red, en orden.
- Varios dispositivos se mantienen sincronizados en cuanto están en
  línea.
- El escáner y la búsqueda en tu propia biblioteca funcionan sin
  conexión. Solo consultar los catálogos necesita red.

## Copia de seguridad

Los ajustes ofrecen una exportación completa.

- **JSON**: todo, préstamos, almacenaje y notas incluidos. Es el formato
  que se vuelve a importar.
- **CSV**: una fila por tomo, para una hoja de cálculo.
- Al importar, **fusionar** completa lo que falta, **reemplazar**
  restaura el estado del archivo.

## Ajustes

- **Tema** claro u oscuro, y siete colores de acento.
- **Idioma**: español, inglés, francés.
- **Perfil público**: una dirección compartible que muestra tu colección
  sin tus precios ni tus notas.
- **Vibración** y **sonido** se apagan por separado.
