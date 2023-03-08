import parseGeoRaster from "georaster";
import GeoRasterLayer from "georaster-layer-for-leaflet";
import get_epsg_code from "geotiff-epsg-code";
import withTimeout from "./with-timeout.js";

export default function createGeoRasterLayer(asset, options) {
  return withTimeout(5 * 1000, async () => {
    const georaster = await parseGeoRaster(asset.getAbsoluteUrl());
    
    // Handle no-data values
    let noDataValues = asset.getNoDataValues();
    if (noDataValues.length > 0) {
      georaster.noDataValue = noDataValues[0];
    }

    if ([undefined, null, "", 32767].includes(georaster.projection) && georaster._geotiff) {
      georaster.projection = await get_epsg_code(georaster._geotiff);
    }

    const layer = new GeoRasterLayer({ georaster, ...options });

    let mins = [];
    let maxs = [];
    let ranges = [];
    for(let i = 0; i < georaster.numberOfRasters; i++) {
      let { minimum, maximum } = asset.getMinMaxValues(i);
      mins.push(minimum);
      maxs.push(maximum);
      ranges.push(maximum - minimum);
    }
    if (mins.every(min => min !== null) && maxs.every(max => max !== null)) {
      layer.currentStats = {mins, maxs, ranges};
      layer.calcStats = false;
    }
    else if (Array.isArray(options.bands) && options.bands.length >= 1 && options.bands.length <= 4) {
      // hack to force GeoRasterLayer to calculate statistics
      layer.calcStats = true;
    }

    return layer;
  });
}
