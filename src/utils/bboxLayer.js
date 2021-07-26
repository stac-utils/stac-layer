import bboxToLatLngBounds from "./bboxToLatLngBounds.js";

export default function bboxLayer (bbox, options) {
  const bounds = bboxToLatLngBounds(bbox);
  return L.rectangle(bounds, options);          
}