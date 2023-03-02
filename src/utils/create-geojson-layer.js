import splitGeoJSON from 'geojson-antimeridian-cut';

export default function createGeoJsonLayer(geojson, style) {
  geojson = splitGeoJSON(geojson);
  return L.geoJSON(geojson, style);
}