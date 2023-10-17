import L from "leaflet";
import loadImage from "easy-image-loader";
import { TIMEOUT } from "./with-timeout.js";

// pratically identical to L.imageOverlay
// with the following exceptions:
// (1) it is async and returns a promise
// (2) if there is any error, the returned promise resolves to null
export default async function imageOverlay(url, bounds, crossOrigin, options) {
  try {
    let img = null;
    try {
      img = await loadImage(url, { crossOrigin, TIMEOUT });
    } catch {
      return null;
    }
    const lyr = L.imageOverlay(img, bounds, options);
    return lyr;
  } catch {
    return null;
  }
}
