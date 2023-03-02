import L from "leaflet";
import tilebelt from "@mapbox/tilebelt";
import loadImage from "easy-image-loader";

// pratically identical to L.tileLayer
// with the following exceptions:
// (1) it is async and returns a promise
// (2) rejects the promise if there is an issue loading the image
// (3) rejects the promise if it takes more than 5 seconds for the image to load
// (4) rejects the promise if attempt to fetch a test tile fails
export default async function tileLayer(tileUrlTemplate, bounds, options = {}) {
  const lyr = L.tileLayer(tileUrlTemplate, options);

  // if know layer bounds, send a request for center of the layer at zoom level 10
  if (bounds) {
    const center = bounds.getCenter();
    const tile = tilebelt.pointToTile(center.lng, center.lat, 10);
    const [x, y, z] = tile;
    const tileURL = L.Util.template(tileUrlTemplate, { s: options.subdomains?.[0], x, y, z, ...options });

    // will throw an error if it fails
    await loadImage(tileURL, { debug: false, timeout: 5 * 1000 });
  }
  return lyr;
}
