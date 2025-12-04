# Simulador de movilidad urbana (PoC)

Prueba de concepto para el Trabajo Fin de Máster sobre un **simulador web de escenarios de movilidad urbana**. El objetivo de esta PoC es disponer de una base técnica sólida:

- Backend en **FastAPI** que consulta servicios OSRM para distintos modos de transporte.
- Frontend en **Vite + React + TypeScript** con **Leaflet** para la visualización sobre mapa.
- Comparación de rutas para **coche, bici y a pie**, con distancias, tiempos e itinerario dibujado en el mapa.

> ⚠️ Nota: esta PoC no integra todavía el modelo de Machine Learning (LPMC). Se centra en la parte de trayectos y enrutado. El modelo se conectará en fases posteriores del TFM.

---

## 1. Arquitectura general

El proyecto está dividido en dos carpetas principales:

- `backend/` – API REST en FastAPI.
- `frontend/` – aplicación web en React/Vite.

### Backend (FastAPI)

- Framework: **FastAPI** (Python 3.11).
- Cliente HTTP: **httpx**.
- Modelos de datos: **Pydantic**.
- Endpoint principal: `POST /api/osrm/routes`.

Este endpoint recibe un origen, un destino y una lista de perfiles (`driving`, `cycling`, `foot`), y devuelve para cada uno:

- distancia en metros,
- duración en segundos,
- geometría de la ruta como lista de puntos `{lat, lon}`.

#### Por qué se utiliza `routing.openstreetmap.de` y no el demoserver oficial de OSRM

Durante las primeras pruebas se utilizó el demoserver oficial de OSRM:

- `https://router.project-osrm.org/route/v1/{profile}/...`

Aunque la API permite indicar distintos perfiles (`driving`, `cycling`, `foot`), la propia comunidad de OSRM indica en sus issues que **el demoserver solo tiene cargado el dataset del perfil de coche**. En la práctica esto se traduce en que:

- las peticiones con `cycling` o `foot` devuelven exactamente la misma distancia y duración que `driving`;
- por tanto, no sirven para analizar comparativamente distintos modos de transporte, que es justo el objetivo del TFM.

Con el fin de evitar montar desde ya una infraestructura propia de OSRM (gestión de contenedores Docker, descarga de extractos OSM, reconstrucción de índices para cada perfil, etc.), pero sin renunciar a rutas diferenciadas por modo, se optó por utilizar las instancias públicas de FOSSGIS:

- `https://routing.openstreetmap.de/routed-car`
- `https://routing.openstreetmap.de/routed-bike`
- `https://routing.openstreetmap.de/routed-foot`

Estas instancias:

- exponen la misma API que OSRM v5,
- disponen de perfiles separados para coche, bici y peatón,
- y son suficientes para una prueba de concepto académica en la que el tráfico de peticiones es moderado.

La decisión se ha encapsulado en un cliente de servicio específico. Si en una fase posterior del TFM se despliega un **OSRM propio**, bastará con cambiar las URLs base en un único punto sin afectar al resto del backend ni al frontend.

#### Opciones futuras: OSRM propio y OpenTripPlanner

A medio plazo se contemplan dos líneas de evolución:

1. **Desplegar un OSRM propio** para los modos individuales (coche, bici, a pie), usando las imágenes oficiales de Docker y extractos OSM ajustados a la ciudad de estudio (Ciudad Real, Valencia, etc.). Esto eliminaría la dependencia de servicios externos y permitiría ajustar los perfiles de enrutado a criterios propios (por ejemplo, penalizar ciertas vías o zonas).
2. **Integrar OpenTripPlanner (OTP)** para el transporte público, a partir de ficheros GTFS. OTP está mejor orientado a itinerarios multimodales con horarios (bus, tren, metro), mientras que OSRM es ideal para modos continuos como coche, bici o caminar. En el diseño del TFM, OSRM y OTP se consideran complementarios.

#### Consideraciones éticas y de buen uso de `routing.openstreetmap.de`

`routing.openstreetmap.de` es una infraestructura pública mantenida por la comunidad FOSSGIS. Desde el punto de vista ético y de buenas prácticas:

- el uso que se hace en este TFM es **moderado y de carácter académico**, equivalente a las peticiones que haría un usuario explorando rutas en un visor web;
- se evita lanzar cargas masivas de experimentos o “stress tests” contra el servicio;
- en caso de necesitar un volumen elevado de simulaciones, la opción adecuada será pasar a una instancia propia de OSRM u otra solución controlada.

Estas consideraciones se tienen en cuenta para no sobrecargar servicios comunitarios y respetar el espíritu de colaboración de la comunidad OpenStreetMap.

### Frontend (Vite + React)

- Bundler/dev server: **Vite**.
- UI: **React** + **TypeScript**.
- Gestión de peticiones y estado de red: **@tanstack/react-query**.
- Mapas: **Leaflet** + **react-leaflet**.

La interfaz permite:

1. Hacer clic en el mapa para fijar alternadamente **origen** y **destino**.
2. Pulsar el botón **“Calcular rutas OSRM”** para consultar el backend.
3. Visualizar una tabla con distancias y tiempos para coche, bici y a pie.
4. Seleccionar el modo (Coche/Bici/A pie) y ver la ruta correspondiente dibujada sobre el mapa.

---

## 2. Requisitos previos

- **Python 3.11** (o similar) instalado y accesible en la línea de comandos.
- **Node.js 24.x LTS** (se ha usado la versión 24.11.x).
- `git` para clonar el repositorio.

Opcional pero recomendable:

- Navegadores: **Chrome** o **Firefox** para desarrollo y demo.
- Evitar extensiones agresivas en el navegador (ver sección de problemas conocidos).

---

## 3. Clonado del repositorio

```bash
git clone https://github.com/ivanuclm/movilidad-urbana-sim.git
cd movilidad-urbana-sim
```

---

## 4. Puesta en marcha del backend (FastAPI)

1. Ir a la carpeta del backend:

   ```bash
   cd backend
   ```

2. Crear y activar un entorno virtual (Windows PowerShell):

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

   En Linux/WSL:

   ```bash
   python -m venv .venv
   source .venv/bin/activate
   ```

3. Instalar dependencias:

   ```bash
   pip install -r requirements.txt
   ```

   (Si no existe el `requirements.txt`, se pueden instalar los paquetes básicos: `fastapi`, `uvicorn[standard]`, `httpx`, `pydantic-settings`, etc.)

4. Ejecutar la API con Uvicorn:

   ```bash
   uvicorn app.main:app --reload
   ```

   Por defecto, la API quedará escuchando en:

   - `http://127.0.0.1:8000`

5. Comprobar que la API responde:

   - `http://127.0.0.1:8000/health` → debería devolver `{"status":"ok"}`.
   - `http://127.0.0.1:8000/docs` → interfaz Swagger/OpenAPI para probar el endpoint `/api/osrm/routes`.

Ejemplo de cuerpo para probar el endpoint en Swagger:

```json
{
  "origin": { "lat": 38.986, "lon": -3.927 },
  "destination": { "lat": 38.99, "lon": -3.92 },
  "profiles": ["driving", "cycling", "foot"]
}
```

---

## 5. Puesta en marcha del frontend (Vite + React)

1. En otra terminal, ir a la carpeta del frontend:

   ```bash
   cd frontend
   ```

2. Instalar dependencias de Node:

   ```bash
   npm install
   ```

3. Lanzar el servidor de desarrollo de Vite:

   ```bash
   npm run dev
   ```

   Vite mostrará algo como:

   ```text
   VITE v7.x.x  ready in XXX ms

     ➜  Local:   http://localhost:5173/
   ```

4. Abrir el navegador en:

   - `http://localhost:5173/`

Deberías ver el **Simulador de movilidad urbana (PoC)** con:

- mapa de OpenStreetMap,
- dos marcadores (origen y destino),
- botones `Coche`, `Bici`, `A pie`,
- botón “Calcular rutas OSRM”,
- y una tabla con las métricas.

---

## 6. Flujo de uso de la demo

1. Haz clic en el mapa:
   - primer clic → mueve el **origen**,
   - segundo clic → mueve el **destino**,
   - siguientes clics → alternan origen/destino.
2. Pulsa **“Calcular rutas OSRM”**:
   - el frontend llama al backend,
   - FastAPI consulta a OSRM para los 3 modos,
   - se pinta la ruta de coche por defecto.
3. Cambia de modo usando los botones:
   - **Coche**, **Bici**, **A pie**,
   - el mapa actualiza la polilínea y la tabla resalta la fila del modo escogido.

---

## 7. Problemas conocidos (navegadores y extensiones)

Durante el desarrollo se detectó un problema concreto usando **Microsoft Edge**:

- En algunas configuraciones, la página aparecía completamente en blanco.
- En la consola del navegador se veían errores como:
  - `Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".`
  - `Uncaught SyntaxError: Unexpected token '<' (at main.tsx:...)`.
- Estos errores estaban relacionados con extensiones y componentes de Edge que inyectan scripts (por ejemplo, el sistema de seguimiento de precios, “shopping”, etc.).

En cambio, el mismo proyecto funcionaba sin problemas en **Google Chrome**.

### Recomendaciones

Si al arrancar el frontend:

- la página se muestra en blanco;
- no aparecen ni el contenido de la plantilla de Vite (logos de Vite/React) ni el mapa;

entonces:

1. Prueba a abrir la aplicación en **otro navegador** (Chrome o Firefox).
2. O abre una ventana en modo **Incógnito / InPrivate**, donde no se cargan las extensiones.
3. Si usas Edge, desactiva temporalmente extensiones relacionadas con “shopping”, “price tracking” o similares.

Para la defensa del TFM se recomienda utilizar un navegador limpio (sin extensiones que modifiquen páginas) para evitar interferencias en la demo.

---

## 8. Próximos pasos

Esta PoC deja preparados:

- El backend de rutas (OSRM) listo para ser usado como **fuente de variables de trayecto**.
- El frontend con:
  - selección interactiva origen–destino,
  - visualización de rutas por perfil,
  - estructura de panel ideal para incorporar el **perfil del viajero** y el **modelo de elección modal**.

Los siguientes desarrollos previstos para el TFM son:

1. Integrar el dataset **LPMC (London Passenger Mode Choice)** y los modelos de Machine Learning proporcionados por el director.
2. Añadir al frontend un formulario de **perfil de viajero** y controles de políticas (coste del coche, tarifas, frecuencia de bus, etc.).
3. Conectar ambos mundos mediante un nuevo endpoint de predicción, combinando:
   - variables del usuario,
   - variables del trayecto derivadas de OSRM,
   - y parámetros de escenario.
4. Extender el simulador con métricas agregadas, gráficos y, en su momento, integración con datos GTFS para transporte público.

Con estos pasos, la base técnica que proporciona este repositorio se convertirá en el núcleo del simulador de movilidad urbana que se presentará en la defensa del TFM.
