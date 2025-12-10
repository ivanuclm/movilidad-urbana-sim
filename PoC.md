# Prueba de concepto TFM: simulador web de movilidad urbana

## 1. Contexto del Trabajo Fin de Máster

El objetivo general del TFM es desarrollar un simulador web de escenarios de movilidad urbana que combine:

- modelos de predicción de elección modal basados en técnicas de Machine Learning,
- servicios de enrutado sobre la red viaria y de transporte público,
- y una interfaz web interactiva con mapa y panel de control para analistas.

Esta prueba de concepto (PoC) se centra en la primera pieza sólida del sistema: una arquitectura **backend + frontend** capaz de:

1. Consultar servicios OSRM para distintos modos de transporte.
2. Exponer una API limpia, desacoplada del front, pensada para usos futuros (incluyendo el modelo de elección modal).
3. Visualizar en un mapa interactivo las rutas obtenidas y sus métricas básicas (distancia y duración).
4. Permitir al usuario alternar entre distintos perfiles de viaje (coche, bici, a pie) y ver la ruta correspondiente.
5. Integrar datos GTFS reales para representar paradas de transporte público en el mapa.

El objetivo de esta PoC no es aún integrar el dataset LPMC ni los modelos de ML del director del TFM, sino **probar toda la tubería de datos de trayecto**: desde la selección origen–destino en la interfaz hasta la consulta a servicios de enrutado, pasando por la API propia y una primera integración con datos de transporte público.

---

## 2. Decisiones sobre servicios de enrutado (OSRM)

### 2.1. Problema del demoserver oficial

En un principio se probó el demoserver oficial de OSRM:

- `https://router.project-osrm.org/route/v1/{profile}/...`

Aunque la API permite indicar distintos perfiles (`driving`, `cycling`, `foot`), en la práctica el demoserver solo tiene cargado el dataset para el perfil de coche. Como consecuencia:

- las llamadas con `cycling` o `foot` devolvían **la misma distancia y duración** que `driving`,
- lo cual es insuficiente para un simulador de movilidad urbana donde es crítico diferenciar modos.

Este comportamiento está documentado en issues del propio repositorio de OSRM: el demoserver solo sirve resultados reales para el perfil de coche y no es adecuado para proyectos que necesiten comparativa entre modos.

Se valoró levantar una instancia propia de OSRM con perfiles `driving`, `foot` y `bike`, pero, en un primer momento, para esta fase del TFM se habría convertido en una sobrecarga de infraestructura (gestión de contenedores, datasets, recursos de CPU/RAM, etc.) que no aportaba valor directo a la PoC.

### 2.2. Uso de los endpoints de routing.openstreetmap.de

Para tener desde el principio **rutas diferenciadas por modo** sin mantener todavía infraestructura propia, se optó inicialmente por utilizar los servicios OSRM públicos de FOSSGIS:

- Coche: `https://routing.openstreetmap.de/routed-car`
- Bici: `https://routing.openstreetmap.de/routed-bike`
- A pie: `https://routing.openstreetmap.de/routed-foot`

Estos endpoints:

- exponen la misma API que OSRM (versión 5),
- permiten solicitar rutas para cada modo con resultados distintos en distancia y duración,
- y son suficientes para prototipos y actividades académicas, siempre con uso responsable.

En esta primera iteración, el backend utilizaba estos tres endpoints de FOSSGIS para los modos `driving`, `cycling` y `foot`, encapsulados en un pequeño cliente OSRM. Esta decisión de diseño permitía, desde el principio, **cambiar de proveedor** (por ejemplo, hacia un OSRM propio) simplemente modificando las URLs base en un único punto del código.

### 2.3. Migración progresiva a OSRM local para el perfil de coche

Tras validar la PoC y discutirlo con el director del TFM, se decidió avanzar hacia una solución más robusta:

- seguir utilizando servicios externos para perfiles secundarios (bici y a pie),
- pero **montar una instancia propia de OSRM para coche** sobre el ámbito geográfico de estudio.

Los motivos principales son:

- evitar posibles restricciones de uso o *rate-limits* si en el futuro se realizan simulaciones masivas,
- tener un mayor control sobre el ámbito de datos (por ejemplo, centrarse en Castilla-La Mancha y Ciudad Real),
- y reforzar los argumentos éticos del TFM respecto al uso responsable de infraestructuras comunitarias.

#### 2.3.1. Datos utilizados: extracto de Castilla-La Mancha

Para la instancia local se ha utilizado un extracto de **Castilla-La Mancha** obtenido desde Geofabrik (`castilla-la-mancha-251209.osm.pbf`).

Este extracto incluye la red viaria de las cinco provincias de la comunidad autónoma, lo que cubre sobradamente el ámbito de interés (Ciudad Real y entorno) con un tamaño de fichero manejable (del orden de decenas de megabytes).

#### 2.3.2. Proceso de construcción del dataset OSRM local

El proceso seguido para construir el dataset de OSRM se basa en la imagen oficial de Docker `osrm/osrm-backend` y en los tres pasos clásicos:

1. **Extracción** con el perfil de coche:

   ```bash
   docker run --rm -t -v "${PWD}:/data" osrm/osrm-backend \
     osrm-extract -p /opt/car.lua /data/castilla-la-mancha-251209.osm.pbf
   ```

2. **Particionado** (algoritmo MLD):

   ```bash
   docker run --rm -t -v "${PWD}:/data" osrm/osrm-backend \
     osrm-partition /data/castilla-la-mancha-251209.osrm
   ```

3. **Customización** de pesos:

   ```bash
   docker run --rm -t -v "${PWD}:/data" osrm/osrm-backend \
     osrm-customize /data/castilla-la-mancha-251209.osrm
   ```

Una vez generados los ficheros `.osrm` y auxiliares, se levanta el servidor OSRM con:

```bash
docker run -t --name osrm-car-clm -p 5000:5000 -v "${PWD}:/data" osrm/osrm-backend \
  osrm-routed --algorithm mld /data/castilla-la-mancha-251209.osrm
```

Esto permite servir la API OSRM en:

- `http://127.0.0.1:5000/route/v1/driving/...`

#### 2.3.3. Estrategia híbrida: coche local, bici y pie remotos

A nivel de backend, la PoC ha evolucionado hacia una **estrategia híbrida**:

- Perfil **`driving`**:
  - se resuelve contra la instancia local de OSRM en `http://127.0.0.1:5000`,
  - utilizando el extracto de Castilla-La Mancha como base de datos.
- Perfiles **`cycling`** y **`foot`**:
  - siguen utilizando los servicios públicos de FOSSGIS (`routing.openstreetmap.de`),
  - lo cual ofrece cobertura más amplia para estos modos mientras se decide si merece la pena construir instancias locales específicas.

Esta estrategia mantiene las ventajas de tener control total sobre coche (modo prioritario en muchos análisis de movilidad urbana) sin renunciar a disponer de rutas para bici y a pie en ámbitos más amplios.

Como efecto colateral, y completamente aceptable a nivel de TFM, las rutas de coche quedan acotadas al ámbito geográfico del extracto de Castilla-La Mancha. Si el usuario selecciona un origen y un destino fuera de dicho ámbito, el servidor puede devolver que no hay ruta (o una ruta degenerada), algo que se puede explicar en la memoria como limitación deliberada del ámbito de estudio.

### 2.4. Información solicitada a OSRM

Para cada petición origen–destino y perfil, se solicitan:

- distancia (`distance`) en metros,
- duración (`duration`) en segundos,
- y la geometría de la ruta mediante `geometries=geojson` y `overview=full`.

La geometría se transforma en una lista de puntos `{lat, lon}` que el frontend consume directamente con Leaflet para pintar la polilínea sobre el mapa.

### 2.5. Consideraciones éticas sobre el uso de `routing.openstreetmap.de`

El uso de `routing.openstreetmap.de` en este TFM se plantea desde una perspectiva de **buen uso de infraestructuras comunitarias**:

- el volumen de peticiones generado por la PoC es reducido y comparable al de un usuario interactuando con un visor cartográfico;
- no se realizan campañas de estrés ni simulaciones masivas contra la instancia pública;
- el modo con mayor volumen esperado de consultas (coche) ya se ha migrado a una instancia propia de OSRM;
- en caso de necesitar más volumen para bici y a pie, también se podría recurrir a instancias propias de OSRM o a otros servicios dedicados.

De este modo se respeta el esfuerzo de la comunidad FOSSGIS/OpenStreetMap que mantiene estas instancias públicas y se alinea el desarrollo del TFM con prácticas responsables en el uso de recursos compartidos.

---

## 3. Arquitectura backend: FastAPI

### 3.1. Estructura general

El backend se ha desarrollado en **Python 3.11** con **FastAPI**, siguiendo una estructura modular:

- `app/main.py`  
  Punto de entrada de la aplicación FastAPI, configuración básica y documentación OpenAPI.
- `app/api/routes_osrm.py`  
  Endpoint principal `/api/osrm/routes`, responsable de orquestar las llamadas a los distintos perfiles OSRM (locales y remotos).
- `app/services/osrm_client.py`  
  Cliente HTTP que se comunica con los servicios OSRM, encapsulando:
  - construcción de URLs por perfil,
  - llamada asíncrona vía `httpx`,
  - parseo y transformación de la respuesta.
- `app/api/routes_gtfs.py` y `app/services/gtfs_loader.py`  
  Lógica asociada a la lectura de feeds GTFS y exposición de paradas de transporte público.
- Modelos Pydantic para los tipos:
  - `Point` (lat, lon),
  - `RouteResult` (perfil, distancia, duración, geometría),
  - `RouteResponse` (origen, destino, lista de resultados),
  - `GtfsStop` (id, nombre, coordenadas, etc.).

Se ha elegido FastAPI por varias razones:

- Integración muy sencilla con Pydantic para el tipado y validación.
- Documentación automática de la API (`/docs`) con schemas auto-generados.
- Facilidad para añadir en el futuro nuevos endpoints (por ejemplo, el de predicción de modo con el modelo entrenado sobre LPMC o endpoints de análisis de escenarios).

### 3.2. Endpoint `/api/osrm/routes`

El endpoint actual acepta un JSON como:

```json
{
  "origin": { "lat": 38.986, "lon": -3.927 },
  "destination": { "lat": 38.99, "lon": -3.92 },
  "profiles": ["driving", "cycling", "foot"]
}
```

y devuelve una respuesta del tipo:

```json
{
  "origin": { "lat": 38.986, "lon": -3.927 },
  "destination": { "lat": 38.99, "lon": -3.92 },
  "results": [
    {
      "profile": "driving",
      "distance_m": 1473.2,
      "duration_s": 162.5,
      "geometry": [
        { "lat": 38.9871, "lon": -3.9280 },
        { "lat": 38.9872, "lon": -3.9283 }
      ]
    },
    {
      "profile": "cycling",
      "distance_m": 1710.4,
      "duration_s": 420.1,
      "geometry": [ ... ]
    },
    {
      "profile": "foot",
      "distance_m": 1650.0,
      "duration_s": 2333.0,
      "geometry": [ ... ]
    }
  ]
}
```

De esta manera, el frontend tiene toda la información necesaria para:

- mostrar métricas numéricas por modo (distancia y duración),
- y representar la ruta seleccionada en el mapa mediante su geometría.

### 3.3. Endpoint `/api/gtfs/stops` e integración con GTFS

Una vez validada la integración con OSRM, se ha añadido una primera capa de datos de transporte público basada en GTFS. En concreto, se ha utilizado un feed GTFS proporcionado por el Consorcio Regional de Transportes de Madrid (CRTM) para autobuses urbanos de la Comunidad de Madrid.

A partir del fichero ZIP GTFS:

- el servicio `gtfs_loader` lee `stops.txt` directamente desde el ZIP,
- se extraen los campos esenciales:
  - `stop_id`, `stop_code`, `stop_name`, `stop_desc`, `stop_lat`, `stop_lon`,
- y se exponen a través del endpoint:

```http
GET /api/gtfs/stops?limit=500
```

El endpoint devuelve un JSON con un listado de paradas, limitado por parámetro `limit` para evitar respuestas excesivamente grandes. Este enfoque permite:

- demostrar que el backend es capaz de leer y procesar feeds GTFS reales,
- disponer de un conjunto de paradas de transporte público que el frontend puede visualizar sobre el mapa,
- y preparar el terreno para una futura integración más profunda con OpenTripPlanner (OTP) u otros motores de enrutado de transporte público.

En fases posteriores del TFM será posible cambiar el feed GTFS por otro que se ajuste mejor al ámbito geográfico de estudio (por ejemplo, un GTFS de Ciudad Real) sin modificar la lógica general del servicio.

---

## 4. Arquitectura frontend: Vite + React + TypeScript

### 4.1. Stack elegido

El frontend se ha construido con:

- **Vite** como bundler y entorno de desarrollo, por su rapidez y simplicidad.
- **React** con **TypeScript**, que facilita la evolución del proyecto y la integración con componentes de mapas.
- **React Query (@tanstack/react-query)** para gestionar las llamadas al backend:
  - maneja estados `isPending`, `error`, `data` de forma declarativa,
  - simplifica la re-ejecución de peticiones y el manejo de errores.
- **Leaflet** + **react-leaflet** para la visualización geográfica sobre mapas de OpenStreetMap.

La estructura básica del frontend es:

- `src/main.tsx`  
  Punto de entrada que envuelve la aplicación en el `QueryClientProvider`.
- `src/App.tsx`  
  Componente principal que contiene:
  - estado de origen y destino,
  - llamada a la API mediante `useMutation` para las rutas OSRM,
  - llamada a la API mediante `useQuery` para las paradas GTFS,
  - layout general (mapa + panel lateral).
- `src/components/MapView.tsx`  
  Componente que:
  - renderiza el mapa de Leaflet,
  - escucha clicks para alternar entre origen y destino,
  - muestra los marcadores de origen/destino,
  - dibuja la polilínea de la ruta seleccionada,
  - y representa las paradas de transporte público como marcadores circulares.

### 4.2. Interacción actual en la interfaz

La interacción para la demo es la siguiente:

1. El usuario hace clic en el mapa:
   - el primer clic mueve el **origen**,
   - el segundo clic mueve el **destino**,
   - y así sucesivamente, alternando entre ambos.
2. Se pulsa el botón **“Calcular rutas OSRM”**:
   - el frontend envía la petición al backend,
   - FastAPI llama a OSRM para los perfiles `driving`, `cycling`, `foot` (con la lógica híbrida local/remoto),
   - y se devuelve la respuesta con resultados y geometrías.
3. En el panel derecho:
   - se muestran las métricas de cada modo en una tabla (distancia en km, duración en minutos),
   - y se resalta la fila del perfil actualmente seleccionado.
4. En la barra superior del panel hay tres botones:
   - **Coche**, **Bici**, **A pie**,
   - al pulsar uno, el mapa actualiza la polilínea y se resalta la fila correspondiente en la tabla.
5. Opcionalmente, el usuario puede activar o desactivar la capa de paradas GTFS, que se visualizan como pequeños círculos (por ejemplo, azules) con un `Tooltip` que muestra el nombre y el código de parada al pasar el ratón.

El layout está diseñado con CSS Grid para que, en pantallas grandes, el mapa ocupe la mayor parte del ancho y altura, quedando el panel como columna lateral. En pantallas pequeñas, el layout se adapta a una disposición vertical (mapa encima, panel debajo).

### 4.3. Marcadores de origen y destino

Los marcadores de origen y destino se han personalizado para mejorar la experiencia de usuario y acercarse al estilo de los planificadores de rutas populares:

- El origen se representa como un “pin” de color verde con un símbolo de reproducción (`▶`) en su interior.
- El destino se representa como un “pin” de color rojo con un símbolo de parada (`■`).

Ambos se han implementado mediante `L.divIcon` con SVG embebido, de forma que:

- no se depende de imágenes externas,
- y se mantiene un estilo consistente con el resto de la interfaz.

Esta decisión puramente visual contribuye a que, en la defensa del TFM, el mapa resulte claro y familiar para cualquier usuario.

---

## 5. Problemáticas encontradas y decisiones técnicas

### 5.1. Extensiones del navegador y errores “Unexpected token '<'”

Durante el desarrollo del frontend, apareció un problema peculiar:

- la aplicación se mostraba **en blanco** en Microsoft Edge,
- la consola de desarrollo mostraba errores del tipo:
  - `Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"`
  - `Uncaught SyntaxError: Unexpected token '<' (at main.tsx:...)`
- sin embargo, el mismo proyecto funcionaba correctamente en Google Chrome.

Tras varias pruebas se comprobó que:

- Vite estaba levantado correctamente y servía los módulos en `http://localhost:5173/`,
- pero algunas extensiones de Edge (relacionadas con seguimiento de precios y métricas de compra online) inyectaban scripts y generaban peticiones adicionales a recursos, mezclando HTML y JS donde no correspondía.

La solución práctica fue:

- utilizar Chrome como navegador principal durante el desarrollo,
- y documentar en el README que, si al arrancar el frontend la página aparece en blanco y no se ven los logos de Vite ni React (en la plantilla inicial) o el mapa en la versión actual:
  - conviene probar en otro navegador,
  - o abrir una ventana en modo incógnito / InPrivate sin extensiones activas.

Esta problemática es especialmente relevante de cara a la defensa del TFM, ya que conviene usar un navegador limpio para evitar errores falsos durante la demo.

### 5.2. Elección de perfiles y servicios OSRM

Otra decisión importante fue cómo gestionar los distintos modos de viaje:

- Se ha optado por empezar con:
  - **Coche** (`driving`),
  - **Bici** (`cycling`),
  - **A pie** (`foot`),
- todos expuestos a través del mismo endpoint backend (`/api/osrm/routes`), pero resueltos mediante la combinación:
  - coche → OSRM local sobre el extracto de Castilla-La Mancha,
  - bici y a pie → servicios de routing.openstreetmap.de.

Además, la API está preparada para añadir nuevos perfiles si en el futuro se integran otros servicios (por ejemplo, itinerarios de transporte público via GTFS/OpenTripPlanner).

### 5.3. Integración progresiva de GTFS

La integración actual de GTFS se limita a la visualización de paradas, pero ha servido para:

- verificar el flujo completo de lectura de un feed GTFS real,
- comprobar que el backend puede parsear correctamente los archivos `stops.txt` desde un ZIP,
- y mostrar en el mapa un primer “layer” de transporte público.

En fases posteriores, se pretende:

- ampliar esta integración para incluir rutas, viajes y horarios (`routes.txt`, `trips.txt`, `stop_times.txt`, `calendar.txt`, etc.),
- y utilizar estos datos como entrada para un motor de enrutado de transporte público (por ejemplo, OTP).

---

## 6. Siguientes pasos previstos

A partir de esta PoC, las próximas líneas de trabajo previstas son:

1. **Integrar el dataset LPMC (London Passenger Mode Choice)**:
   - replicar parcialmente el preprocesamiento ya realizado por el director en sus scripts de Python,
   - entrenar modelos de elección modal (por ejemplo, XGBoost, Random Forest, etc.), o reutilizar modelos ya entrenados,
   - y exponer un endpoint de predicción que reciba:
     - variables del usuario (sociodemográficas),
     - variables del trayecto (tiempos, costes, etc.),
     - y devuelva probabilidades para cada modo de transporte.

2. **Diseñar el panel de “perfil de viajero”** en el frontend:
   - formulario para introducir atributos básicos del viajero,
   - sliders para variables de política (coste del coche, tarifas, frecuencia de bus, etc.),
   - y conexión con el modelo de ML para generar escenarios what–if.

3. **Profundizar en la incorporación de datos de transporte público (GTFS)**:
   - integración con OpenTripPlanner u otras soluciones de enrutado multimodal,
   - cálculo de tiempos y transbordos en transporte público para compararlos con coche, bici y a pie,
   - posible visualización de rutas y paradas en el mapa, incluyendo líneas activas, frecuencias y horarios.

4. **Métricas agregadas y cuadros de mando**:
   - cálculo de indicadores como:
     - reparto modal estimado,
     - tiempo medio de viaje,
     - emisiones de CO₂,
   - y visualización mediante gráficos y mapas de calor.

Esta prueba de concepto deja, por tanto, una base robusta sobre la que construir el resto del TFM, validando ya la comunicación con servicios de enrutado (tanto externos como locales), el diseño de la API y la experiencia básica de usuario sobre mapa, así como una primera integración real con datos de transporte público en formato GTFS.
