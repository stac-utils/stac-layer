/**
 *
 * @param {Number[]} bbox
 * @description convert bounding box in format [xmin, ymin, xmax, ymax] to Leaflet Bounds
 * @returns
 */
export default function bboxToLatLngBounds(bbox) {
  const [xmin, ymin, xmax, ymax] = bbox;
  const southWest = [ymin, xmin];
  const northEast = [ymax, xmax];
  return L.latLngBounds(southWest, northEast);
}
