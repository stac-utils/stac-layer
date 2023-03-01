import parseGeoRaster from "georaster";
import GeoRasterLayer from "georaster-layer-for-leaflet";
import get_epsg_code from "geotiff-epsg-code";
import withTimeout from "./with-timeout.js";

export default function createGeoRasterLayer(url, options) {
  return withTimeout(5 * 1000, async () => {
    const georaster = await parseGeoRaster(url);

    // just in case
    if (options.debugLevel < 0) options.debugLevel = 0;

    if ([undefined, null, "", 32767].includes(georaster.projection)) {
      if (georaster._geotiff) {
        georaster.projection = await get_epsg_code(georaster._geotiff);
      }
    }

    const layer = new GeoRasterLayer({ georaster, ...options });

    // hack to force GeoRasterLayer to calculate statistics
    if (options.calcStats) layer.calcStats = true;

    return layer;
  });
}
