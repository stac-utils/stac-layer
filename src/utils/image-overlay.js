import L from "leaflet";

// pratically identical to L.imageOverlay
// with the following exceptions:
// (1) it is async and returns a promise
// (2) rejects the promise if there is an issue loading the image
// (3) rejects the promise if it takes more than 10 seconds for the image to load
export default function imageOverlay (url, bounds, options) {
  return new Promise((resolve, reject) => {
    try {
      let timeout;
      const img = document.createElement("IMG");
      img.onload = function () {
        const lyr = L.imageOverlay(img, bounds, options);
        if (timeout) clearTimeout(timeout);
        resolve(lyr);
      }
      img.onerror = error => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      }
      img.src = url;
    } catch (error) {
      reject(error);
    }

    timeout = setTimeout(() => reject("timed out"), 10 * 1000);
  });
}
