import L from "leaflet";
import loadImage from "easy-image-loader";

// pratically identical to L.imageOverlay
// with the following exceptions:
// (1) it is async and returns a promise
// (2) rejects the promise if there is an issue loading the image
// (3) rejects the promise if it takes more than 5 seconds for the image to load
export default async function imageOverlay(url, bounds, crossOrigin, options) {
  const timeout = 5 * 1000; // 5 seconds
  let img = null
  try {
    img = await loadImage(url, { crossOrigin, timeout });
  }
  catch {
    return null
  }
  const lyr = L.imageOverlay(img, bounds, options);
  return lyr;
}
