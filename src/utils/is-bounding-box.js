export default function isBoundingBox (bbox) {
  return Array.isArray(bbox) && bbox.length === 4 && bbox.every(n => typeof n === "number") && bbox[0] < bbox[2] && bbox[1] < bbox[3];
}
