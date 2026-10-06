import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const maps = new Map();
const COLORS = ['#24b964', '#4b91dc', '#ee911d', '#d92d50', '#96a6a0'];
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>';

function getMap(id, onTileError) {
  let entry = maps.get(id);
  if (!entry) {
    const map = L.map(id, {scrollWheelZoom: false, preferCanvas: true});
    entry = {map, overlay: L.layerGroup().addTo(map), onTileError};
    L.tileLayer(TILES, {maxZoom: 19, attribution: ATTRIBUTION})
      .on('tileerror', () => entry.onTileError?.()).addTo(map);
    maps.set(id, entry);
  }
  entry.onTileError = onTileError;
  const {map, overlay} = entry;
  overlay.clearLayers();
  map.invalidateSize();
  return entry;
}

export function closeMap(id) {
  maps.get(id)?.map.remove();
  maps.delete(id);
}

export function refreshMap(id) {
  maps.get(id)?.map.invalidateSize();
}

export function showSoloMap(profile, onTileError) {
  if (!profile.geometry.length) return false;
  const {map, overlay} = getMap('grade-osm', onTileError);
  const bounds = L.latLngBounds([]);
  // Join only adjacent edges with matching grade and identical endpoints.
  let run = [], previous = null, grade = null;
  const flush = () => {
    if (run.length > 1) L.polyline(run, {color: COLORS[grade < 0 ? 4 : grade], weight: 5,
      dashArray: grade < 0 ? '4 7' : undefined}).addTo(overlay);
    run = [];
  };
  for (const [lat1,lon1,lat2,lon2,bin] of profile.geometry) {
    bounds.extend([lat1,lon1]);bounds.extend([lat2,lon2]);
    if (bin !== grade || !previous || previous[0] !== lat1 || previous[1] !== lon1) flush();
    if (!run.length) run.push([lat1,lon1]);
    run.push([lat2,lon2]);previous = [lat2,lon2];grade = bin;
  }
  flush();
  if (bounds.isValid()) map.fitBounds(bounds, {padding: [24,24], maxZoom: 16});
  return true;
}

export function showCompareMap(tracks, fit = false, onTileError) {
  if (!tracks.length) return false;
  const {map, overlay} = getMap('compare-osm', onTileError);
  const bounds = L.latLngBounds([]);
  for (const {side, full, selected, start, end} of tracks) {
    const color = side === 'first' ? '#176bc8' : '#e26b17';
    for (const run of full) {
      const coords = run.map(([,lat,lon]) => [lat,lon]);
      if (coords.length < 2) continue;
      L.polyline(coords, {color, weight: 3, opacity: .35}).addTo(overlay);
      for (const point of coords) bounds.extend(point);
    }
    for (const run of selected) {
      if (run.length < 2) continue;
      const coords = run.map(([,lat,lon]) => [lat,lon]);
      L.polyline(coords, {color: '#fff', weight: 9}).addTo(overlay);
      L.polyline(coords, {color, weight: 5, dashArray: side === 'second' ? '9 7' : undefined}).addTo(overlay);
    }
    for (const [point,label] of [[start,'D'],[end,'F']]) {
      if (!point) continue;
      // Permanent tooltips fade out after removal, briefly duplicating labels
      // while the sliders move. Div icons disappear with their markers.
      const icon = L.divIcon({className: 'map-point-marker ' + side,
        html: label + (side === 'first' ? '1' : '2'), iconSize: [24, 24], iconAnchor: [12, 12]});
      L.marker([point[1],point[2]], {icon, interactive: false, keyboard: false}).addTo(overlay);
    }
  }
  if (fit && bounds.isValid()) map.fitBounds(bounds, {padding: [24,24], maxZoom: 16});
  return true;
}
