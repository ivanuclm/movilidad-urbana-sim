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

El objetivo de esta PoC no es aún integrar el dataset LPMC ni los modelos de ML del director del TFM, sino **probar toda la tubería de datos de trayecto**: desde la selección origen–destino en la interfaz hasta la consulta a servicios de enrutado, pasando por la API propia.

---

## 2. Decisiones sobre servicios de enrutado (OSRM)

### 2.1. Problema del demoserver oficial

En un principio se probó el demoserver oficial de OSRM:

- `https://router.project-osrm.org/route/v1/{profile}/...`

Aunque la API permite indicar distintos perfiles (`driving`, `cycling`, `foot`), en la práctica el demoserver solo tiene cargado el dataset para el perfil de coche. Como consecuencia:

- las llamadas con `cycling` o `foot` devolvían **la misma distancia y duración** que `driving`,
- lo cual es insuficiente para un simulador de movilidad urbana donde es crítico diferenciar modos.

Este comportamiento está documentado en issues del propio repositorio de OSRM: el demoserver solo sirve resultados reales para el perfil de coche y no es adecuado para proyectos que necesiten comparativa entre modos.

Se valoró levantar una instancia propia de OSRM con perfiles `driving`, `foot` y `bike`, pero para esta fase del TFM habría supuesto una sobrecarga de infraestructura (gestión de contenedores, datasets, recursos de CPU/RAM, etc.) que no aportaba valor directo a la PoC.

### 2.2. Cambio a los endpoints de routing.openstreetmap.de

Para tener desde el principio **rutas diferenciadas por modo** sin mantener nuestra propia infraestructura OSRM, se optó por utilizar los servicios OSRM públicos de FOSSGIS:

- Coche: `https://routing.openstreetmap.de/routed-car`
- Bici: `https://routing.openstreetmap.de/routed-bike`
- A pie: `https://routing.openstreetmap.de/routed-foot`

Estos endpoints:

- exponen la misma API que OSRM (versión 5),
- permiten solicitar rutas para cada modo con resultados distintos en distancia y duración,
- y son suficientes para prototipos y actividades académicas, siempre con uso responsable.

En el backend se ha encapsulado esta decisión en un pequeño cliente OSRM, de forma que, si en el futuro se monta un servidor propio (por ejemplo, para Ciudad Real o Valencia), solo habría que cambiar las URLs base en un único punto.

### 2.3. Información solicitada a OSRM

Para cada petición origen–destino y perfil, se solicitan:

- distancia (`distance`) en metros,
- duración (`duration`) en segundos,
- y la geometría de la ruta mediante `geometries=geojson` y `overview=full`.

La geometría se devuelve como una lista de puntos `{lat, lon}` que el frontend puede consumir directamente con Leaflet para pintar la polilínea sobre el mapa.

---

## 3. Arquitectura backend: FastAPI

### 3.1. Estructura general

El backend se ha desarrollado en **Python 3.11** con **FastAPI**, siguiendo una estructura modular:

- `app/main.py`  
  Punto de entrada de la aplicación FastAPI, configuración básica y documentación OpenAPI.
- `app/api/routes_osrm.py`  
  Endpoint principal `/api/osrm/routes`, responsable de orquestar las llamadas a OSRM.
- `app/services/osrm_client.py`  
  Cliente HTTP que se comunica con los servicios OSRM (routing.openstreetmap.de), encapsulando:
  - construcción de URLs por perfil,
  - llamada asíncrona vía `httpx`,
  - parseo y transformación de la respuesta.
- Modelos Pydantic para los tipos:
  - `Point` (lat, lon),
  - `RouteResult` (perfil, distancia, duración, geometría),
  - `RouteResponse` (origen, destino, lista de resultados).

Se ha elegido FastAPI por varias razones:

- Integración muy sencilla con Pydantic para el tipado y validación.
- Documentación automática de la API (`/docs`) con schemas auto-generados.
- Facilidad para añadir en el futuro nuevos endpoints (por ejemplo, el de predicción de modo con el modelo entrenado sobre LPMC).

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
  - llamada a la API mediante `useMutation`,
  - layout general (mapa + panel lateral).
- `src/components/MapView.tsx`  
  Componente que:
  - renderiza el mapa de Leaflet,
  - escucha clicks para alternar entre origen y destino,
  - muestra los marcadores,
  - y dibuja la polilínea de la ruta seleccionada.

### 4.2. Interacción actual en la interfaz

La interacción para la demo es la siguiente:

1. El usuario hace clic en el mapa:
   - el primer clic mueve el **origen**,
   - el segundo clic mueve el **destino**,
   - y así sucesivamente, alternando entre ambos.
2. Se pulsa el botón **“Calcular rutas OSRM”**:
   - el frontend envía la petición al backend,
   - FastAPI llama a OSRM para los perfiles `driving`, `cycling`, `foot`,
   - y se devuelve la respuesta con resultados y geometrías.
3. En el panel derecho:
   - se muestran las métricas de cada modo en una tabla (distancia en km, duración en minutos),
   - y se resalta la fila del perfil actualmente seleccionado.
4. En la barra superior del panel hay tres botones:
   - **Coche**, **Bici**, **A pie**,
   - al pulsar uno, el mapa actualiza la polilínea y se resalta la fila correspondiente en la tabla.

El layout está diseñado con CSS Grid para que, en pantallas grandes, el mapa ocupe la mayor parte del ancho y altura, quedando el panel como columna lateral. En pantallas pequeñas, el layout se adapta a una disposición vertical (mapa encima, panel debajo).

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
- todos servidos desde `routing.openstreetmap.de` para obtener tiempos y distancias coherentes y diferenciados.

Además, la API está preparada para añadir nuevos perfiles si en el futuro se integran otros servicios (por ejemplo, itinerarios de transporte público via GTFS e integraciones con OpenTripPlanner).

---

## 6. Siguientes pasos previstos

A partir de esta PoC, las próximas líneas de trabajo previstas son:

1. **Integrar el dataset LPMC (London Passenger Mode Choice)**:
   - replicar parcialmente el preprocesamiento ya realizado por el director en sus scripts de Python,
   - entrenar modelos de elección modal (por ejemplo, XGBoost, Random Forest, etc.),
   - y exponer un endpoint de predicción que reciba:
     - variables del usuario (sociodemográficas),
     - variables del trayecto (tiempos, costes, etc.),
     - y devuelva probabilidades para cada modo de transporte.

2. **Diseñar el panel de “perfil de viajero”** en el frontend:
   - formulario para introducir atributos básicos del viajero,
   - sliders para variables de política (coste del coche, tarifa del bus, frecuencia, etc.),
   - y conexión con el modelo de ML para generar escenarios what–if.

3. **Incorporar datos de transporte público (GTFS)**:
   - integración con OpenTripPlanner u otras soluciones,
   - cálculo de tiempos y transbordos en transporte público para compararlos con coche, bici y a pie,
   - posible visualización de rutas y paradas en el mapa.

4. **Métricas agregadas y cuadros de mando**:
   - cálculo de indicadores como:
     - reparto modal estimado,
     - tiempo medio de viaje,
     - emisiones de CO₂,
   - y visualización mediante gráficos y mapas de calor.

Esta prueba de concepto deja, por tanto, una base robusta sobre la que construir el resto del TFM, validando ya la comunicación con servicios de enrutado, el diseño de la API y la experiencia básica de usuario sobre mapa.
