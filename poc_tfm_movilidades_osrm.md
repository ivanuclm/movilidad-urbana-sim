
# PoC TFM: Simulador web de movilidad urbana

## 1. Contexto y objetivo de la prueba de concepto

Este documento describe la prueba de concepto inicial del Trabajo Fin de Máster:

> Simulador web de escenarios de movilidad urbana mediante técnicas de inteligencia artificial.

Objetivo de la PoC:

- Comprobar que podemos integrar un backend web con servicios de enrutado basados en OpenStreetMap.
- Obtener variables del trayecto (distancia y tiempo por modo) que sean coherentes con las variables utilizadas en el dataset LPMC (London Passenger Mode Choice).
- Dejar preparada una base técnica sobre la que más adelante se integrarán:
  - modelos de elección modal entrenados por el director del TFM, y
  - datos de transporte público (GTFS) mediante OpenTripPlanner u otro motor.

Esta PoC todavía **no** integra modelos de Machine Learning, solo la parte de enrutado y exposición de una API propia.

---

## 2. Arquitectura técnica actual

### 2.1. Backend

- Lenguaje: **Python 3.11**
- Framework web: **FastAPI**
- Servidor ASGI: **Uvicorn**
- Cliente HTTP asíncrono: **httpx**

Estructura básica del backend:

- `app/main.py`  
  - Inicializa FastAPI.
  - Configura CORS para permitir peticiones desde el frontend.
  - Expone:
    - `GET /health` para comprobar que el servicio está vivo.
    - Router `osrm` bajo el prefijo `/api/osrm`.

- `app/api/routes_osrm.py`  
  - Define el endpoint:
    - `POST /api/osrm/routes`
  - Entrada:
    - Origen y destino (lat, lon).
    - Lista de perfiles de ruta: `["driving", "cycling", "foot"]`.
  - Salida:
    - Distancia y duración por cada perfil.

- `app/services/osrm_client.py`  
  - Encapsula las llamadas HTTP al servidor de enrutado (OSRM o equivalente).
  - Permite cambiar de servidor o de estrategia sin afectar al resto del código.

Esta API será el punto de entrada para el frontend y, más adelante, para el módulo de predicción modal.

---

## 3. Servicios de enrutado: OSRM y problemas detectados

### 3.1. OSRM demo server: solo coche

La primera aproximación fue usar el servidor público de OSRM:

- URL base: `https://router.project-osrm.org`

Este servidor se menciona frecuentemente como "demo server" y acepta URLs del estilo:

```text
/route/v1/{profile}/{lon1},{lat1};{lon2},{lat2}
```

donde `{profile}` puede ser `driving`, `cycling` o `walking` según la documentación del API HTTP. Sin embargo, en la práctica:

- El **demo server solo tiene cargado un dataset con el perfil de coche**, de modo que:
  - Se ignora el perfil en la URL.
  - Cualquier petición devuelve siempre rutas y tiempos correspondientes al perfil de coche. 

Esto provoca que, aunque desde nuestra API interna pidamos perfiles distintos:

```json
"profiles": ["driving", "cycling", "foot"]
```

el servidor devuelve resultados con la misma distancia y duración para los tres modos, lo cual no es válido para un simulador de movilidad.

Conclusión:

- El demo server de OSRM es útil para experimentar rápidamente con rutas en coche, pero **no sirve** como base para diferenciar coche, bici y peatón dentro del TFM.

### 3.2. Alternativas planteadas

Se han considerado tres alternativas:

1. **Mantener router.project-osrm.org y recalcular duraciones a partir de la distancia**  
   - Usar el demo server solo para obtener la distancia (y la geometría).
   - Aplicar velocidades medias según el modo (por ejemplo, 60 km/h para coche, 18 km/h para bici, 4.5 km/h a pie).
   - Es una solución rápida y válida como PoC, pero las rutas seguirían siendo las de coche y no respetarían caminos exclusivos para bici o peatones.

2. **Montar un servidor OSRM propio con varios perfiles**  
   - Seguir la recomendación oficial de levantar contenedores Docker con OSRM y procesar los datos OSM con perfiles `car`, `bike` y `foot`.  
   - Ventaja: máximo control y coherencia entre modos.
   - Inconveniente: coste de administración y recursos (especialmente para coberturas grandes).

3. **Usar un servidor OSRM de terceros con perfiles múltiples**  
   - Concretamente, el servicio operativo de FOSSGIS: `https://routing.openstreetmap.de`.
   - Este servicio está documentado como:
     - Basado en OSRM.
     - Con perfiles **car, bike y foot** a escala mundial.  
   - Tiene una política de uso razonable para un TFM:
     - Máximo 1 petición por segundo.
     - Obligación de mostrar atribución a OpenStreetMap y a FOSSGIS.

Para esta primera fase se ha optado por la **opción 3**, como solución intermedia: permite obtener resultados realistas y distinguir modos sin tener todavía infraestructura propia.

---

## 4. Decisión actual: uso de `routing.openstreetmap.de`

### 4.1. Perfiles disponibles

El servicio `routing.openstreetmap.de` expone diferentes perfiles de enrutado, entre ellos:

- `routed-car`
- `routed-bike`
- `routed-foot`  

La particularidad es que el perfil se codifica en el path base de la URL, y no tanto en el segmento `{profile}` típico de OSRM. Las llamadas tienen esta forma:

- Coche:

  ```text
  https://routing.openstreetmap.de/routed-car/route/v1/driving/{lon1},{lat1};{lon2},{lat2}
  ```

- Bici:

  ```text
  https://routing.openstreetmap.de/routed-bike/route/v1/driving/{lon1},{lat1};{lon2},{lat2}
  ```

- A pie:

  ```text
  https://routing.openstreetmap.de/routed-foot/route/v1/driving/{lon1},{lat1};{lon2},{lat2}
  ```

Aunque el segmento `route/v1/driving` se mantiene, el perfil real lo determina el prefijo `routed-car`, `routed-bike` o `routed-foot`.

### 4.2. Integración en `osrm_client.py`

En el backend se ha implementado un cliente que asigna una URL base distinta según el modo:

```python
from typing import Literal
import httpx

Profile = Literal["driving", "cycling", "foot"]

OSRM_BASE_URLS = {
    "driving": "https://routing.openstreetmap.de/routed-car",
    "cycling": "https://routing.openstreetmap.de/routed-bike",
    "foot": "https://routing.openstreetmap.de/routed-foot",
}

async def get_route(profile: Profile, lon1: float, lat1: float, lon2: float, lat2: float):
    base = OSRM_BASE_URLS[profile]
    url = (
        f"{base}/route/v1/driving/"
        f"{lon1},{lat1};{lon2},{lat2}"
        "?overview=false&alternatives=false&annotations=duration,distance"
    )
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()

    route = data["routes"][0]
    return {
        "profile": profile,
        "distance_m": route["distance"],
        "duration_s": route["duration"],
    }
```

Con este cambio:

- El endpoint interno `POST /api/osrm/routes` no cambia su interfaz.
- Para un mismo origen y destino, ahora:
  - `driving`, `cycling` y `foot` devuelven la misma distancia de ruta, pero
  - duraciones diferentes según el perfil y restricciones específicas de cada modo.

Esta aproximación es suficiente para:

- Probar el flujo de generación de variables del trayecto.
- Empezar a alinear estas variables con las usadas en LPMC.
- Enseñar en la defensa rutas diferenciadas por modo sobre el mapa.

---

## 5. Conexión con el dataset LPMC y futuros modelos

Aunque en esta PoC no se integran aún modelos de ML, la arquitectura se diseña pensando en los pasos siguientes:

1. **Variables del trayecto**  
   La respuesta de OSRM (o de otros servicios futuros como OpenTripPlanner) se mapeará a variables similares a las del LPMC, por ejemplo:

   - `distance` (distancia del viaje).
   - `dur_driving`, `dur_cycling`, `dur_walking`.
   - En fases posteriores, con transporte público:
     - `dur_pt_total`, `dur_pt_rail`, `dur_pt_bus`, `pt_n_interchanges`, `cost_transit`, etc.

2. **Variables del usuario**  
   Se recogerán desde el frontend mediante formularios de perfil de viajero:

   - Edad, género, licencia de conducir.
   - Propiedad de coche.
   - Tipo de abono de transporte, etc.

3. **Modelos de elección modal**  
   El director del TFM se encargará de entrenar modelos con el LPMC aplicando las transformaciones que considere adecuadas (one hot encoding, variables de tiempo, etc.). La API backend solo tendrá que:

   - Construir el vector de características con las mismas columnas.
   - Enviar ese vector al modelo entrenado (cargado en memoria o expuesto en otro servicio).
   - Devolver al frontend las probabilidades por modo.

Este diseño permite cambiar de ciudad (Londres, Ciudad Real, Valencia, etc.) usando la misma lógica de modelo, aunque el dataset de entrenamiento sea el LPMC, aceptando esa simplificación para efectos del TFM.

---

## 6. Transporte público y GTFS: hoja de ruta

El objetivo final del simulador es incluir, además de coche, bici y peatón, al menos un modo de transporte público (bus, tren de cercanías u otro). Para ello se contempla:

1. **Integrar un motor de enrutado multimodal**, siendo la opción más natural:
   - **OpenTripPlanner (OTP)**, que utiliza:
     - Datos de red viaria de OpenStreetMap.
     - Horarios y líneas de PT en formato **GTFS** (autobús urbano, metro, cercanías, etc.).

2. **Fuentes de GTFS**  
   - Muchas ciudades españolas y operadores de transporte publican GTFS, incluyendo EMT Valencia, EMT Madrid y los servicios de Renfe Cercanías.
   - Estos ficheros permitirán obtener tiempos y rutas realistas de PT, así como números de transbordos.

3. **Integración en el backend**  
   - Se añadirá un nuevo cliente `otp_client.py` con llamadas a la API `/plan` de OTP.
   - Se derivarán variables análogas a las del LPMC para transporte público.

4. **Escenarios what-if**  
   - A partir de esas variables, el simulador permitirá aplicar cambios de política:
     - variaciones en tarifas,
     - penalizaciones al coche,
     - cambios de frecuencias de autobús, etc.
   - Y observar el impacto en el reparto modal calculado por el modelo de ML.

---

## 7. Visualización y front-end (futuro inmediato)

Aunque este documento se centra en el backend y en el enrutado, ya se ha comenzado a preparar un frontend con:

- **React + TypeScript** y Vite.
- **React Leaflet** para el mapa:
  - Permitir al usuario seleccionar origen y destino con clic.
  - Enviar la petición al backend y visualizar en tabla las distancias y tiempos por modo.
- A medio plazo:
  - Mostrar las rutas en el mapa.
  - Añadir un cuadro de mando con gráficos de reparto modal.
  - Incluir heatmaps con los puntos de origen/destino más frecuentes y perfiles de movilidad.

---

## 8. Trabajo futuro e incrementos previstos

Esta mini memoria se irá ampliando conforme se vayan completando hitos. A corto plazo, los siguientes pasos técnicos son:

1. Consolidar el frontend con React Leaflet y la llamada a `/api/osrm/routes`.
2. Definir claramente el mapeo de variables LPMC ↔ variables calculadas desde OSRM/OTP.
3. Integrar el primer modelo de elección modal entrenado por el director.
4. Diseñar el esquema de base de datos (PostgreSQL + PostGIS) para almacenar:
   - viajes simulados,
   - perfiles de usuario,
   - escenarios de política de transporte.
5. Implementar visualizaciones avanzadas:
   - mapas de calor,
   - agregados por barrio o zona,
   - comparativa de escenarios.

Este enfoque incremental permite tener siempre una demo funcional para enseñar en reuniones de seguimiento y, en su momento, en la defensa del TFM.
