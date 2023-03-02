import splitGeoJSON from 'geojson-antimeridian-cut';

export default function createGeoJsonLayer(geojson, options) {
  geojson = splitGeoJSON(geojson);
  return L.geoJSON(geojson, options);
}