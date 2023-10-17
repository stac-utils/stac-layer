/**
 *
 * @param {Number[]} bbox
 * @description convert bounding box in format [xmin, ymin, xmax, ymax] to Leaflet Bounds
 * @returns
 */
export default function bboxToLatLngBounds(bbox) {
  let xmin, ymin, xmax, ymax, _;
  if (bbox.length === 6) {
    [xmin, ymin, _, xmax, ymax, _] = bbox;
  }
  else if (bbox.length === 4) {
    [xmin, ymin, xmax, ymax] = bbox;
  }
  else {
    return null;
  }
  const southWest = [ymin, xmin];
  const northEast = [ymax, xmax];
  return L.latLngBounds(southWest, northEast);
}
