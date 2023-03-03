import { Asset } from "stac-js";
import { isBoundingBox } from "stac-js/src/geo";
import bboxToLatLngBounds from "./bboxToLatLngBounds";

export default function getBounds(object, options) {
  if (object instanceof Asset && object.getContext()) {
    let bbox = object.getContext().getBoundingBox();
    if (isBoundingBox(bbox)) {
      return bboxToLatLngBounds(bbox);
    }
  }
  
  if (options.latLngBounds) {
    return options.latLngBounds;
  } else if (isBoundingBox(options.bbox)) {
    return bboxToLatLngBounds(options.bbox);
  }
  return null;
}