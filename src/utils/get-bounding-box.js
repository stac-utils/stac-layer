import getDepth from "get-depth";
import isBoundingBox from "./is-bounding-box.js";

export default function getBoundingBox(item) {
  if (isBoundingBox(item.bbox)) {
    return item.bbox;
  } else if (item?.extent?.spatial?.bbox) {
    const bbox = item?.extent?.spatial?.bbox;
    const depth = getDepth(bbox);
    if (Array.isArray(bbox) && bbox.length === 4 && depth === 1) {
      return bbox;
    } else if (depth === 2) {
      return bbox[0];
    }
  }
}
