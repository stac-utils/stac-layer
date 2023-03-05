import parseGeoRaster from "georaster";
import GeoRasterLayer from "georaster-layer-for-leaflet";
import get_epsg_code from "geotiff-epsg-code";
import withTimeout from "./with-timeout.js";

export default function createGeoRasterLayer(asset, options) {
  return withTimeout(5 * 1000, async () => {
    const georaster = await parseGeoRaster(asset.getAbsoluteUrl());
    
    // Handle no-data values
    // todo: per band?
    let noDataValues = asset.getNoDataValues();
    if (noDataValues.length > 0) {
      georaster.noDataValue = noDataValues[0];
    }

    // todo: handle min/max values (per band)

    // just in case
    if (options.debugLevel < 0) options.debugLevel = 0;

    if ([undefined, null, "", 32767].includes(georaster.projection)) {
      if (georaster._geotiff) {
        georaster.projection = await get_epsg_code(georaster._geotiff);
      }
    }

    // todo: mask based on the geometry?
    // https://github.com/GeoTIFF/georaster-layer-for-leaflet/blob/master/ADVANCED.md#masking
    const layer = new GeoRasterLayer({ georaster, ...options });

    // hack to force GeoRasterLayer to calculate statistics
    if (options.calcStats) layer.calcStats = true;

    return layer;
  });
}
