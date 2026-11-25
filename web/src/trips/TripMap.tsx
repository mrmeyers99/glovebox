// The MapLibre map. Imported lazily by MapPanel so maplibre-gl lands in its
// own chunk and stays off the trip list page.

import 'maplibre-gl/dist/maplibre-gl.css'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {
  AttributionControl,
  Map,
  NavigationControl,
} from 'react-map-gl/maplibre'
import type { Stop } from '../lib/database.types'
import {
  FIT_MAX_ZOOM,
  FIT_PADDING,
  MAP_STYLE_URL,
  OSM_ATTRIBUTION,
  initialBounds,
} from './mapView'

// MapLibre finds its worker next to its own module file. Vite moves that
// module (pre-bundling in dev, chunking in builds) and doesn't copy the worker,
// so point MapLibre at a URL that Vite serves and emits.
maplibregl.setWorkerUrl(workerUrl)

export default function TripMap({ stops }: { stops: readonly Stop[] }) {
  return (
    <Map
      // Fit once on load; later stop edits don't move the map under the user.
      initialViewState={{
        bounds: initialBounds(stops),
        fitBoundsOptions: { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
      }}
      // The same instance we set the worker URL on, not react-map-gl's own import.
      mapLib={maplibregl}
      mapStyle={MAP_STYLE_URL}
      attributionControl={false}
      style={{ width: '100%', height: '100%' }}
    >
      <NavigationControl position="top-right" />
      <AttributionControl
        position="bottom-right"
        compact={false}
        customAttribution={OSM_ATTRIBUTION}
      />
    </Map>
  )
}
