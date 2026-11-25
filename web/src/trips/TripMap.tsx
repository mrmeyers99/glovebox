// The MapLibre map. Imported lazily by MapPanel so maplibre-gl lands in its
// own chunk and stays off the trip list page.

import 'maplibre-gl/dist/maplibre-gl.css'
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
  initialBounds,
} from './mapView'

export default function TripMap({ stops }: { stops: readonly Stop[] }) {
  return (
    <Map
      // Fit once on load; later stop edits don't move the map under the user.
      initialViewState={{
        bounds: initialBounds(stops),
        fitBoundsOptions: { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
      }}
      mapStyle={MAP_STYLE_URL}
      attributionControl={false}
      style={{ width: '100%', height: '100%' }}
    >
      <NavigationControl position="top-right" />
      <AttributionControl position="bottom-right" compact={false} />
    </Map>
  )
}
