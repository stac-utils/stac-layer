import { bindDataToClickEvent, log, setFallback } from "./events.js";
import StacLayerError from "./utils/error.js";
import imageOverlay from "./utils/image-overlay.js";
import tileLayer from './utils/tile-layer.js';
import createGeoJsonLayer from "./utils/create-geojson-layer.js";
import createGeoRasterLayer from './utils/create-georaster-layer.js';
import parseAlphas from './utils/parse-alphas.js';
import bboxToLatLngBounds from "./utils/bboxToLatLngBounds.js";
import { Asset } from 'stac-js';
import { isBoundingBox } from "stac-js/src/geo.js";

export function addFootprintLayer(data, layerGroup, options) {
  // Add the geometry/bbox
  let geojson;
  if (data.isItemCollection() || data.isCollectionCollection()) {
    geojson = toGeoJSON(data.getBoundingBox());
  }
  else {
    geojson = data.toGeoJSON();
  }
  if (!geojson) {
    const bounds = getBounds(data, options);
    log(2, 'No geojson found for footprint, falling back to bbox if available', bounds);
    if (bounds) {
      const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
      geojson = toGeoJSON(bbox);
    }
  }
  if (geojson) {
    log(1, "adding footprint layer");
    let style = {};
    if (layerGroup.getLayers().length > 0) {
      style.fillOpacity = 0;
    }
    style = Object.assign({}, options.boundsStyle, style);
    const lyr = createGeoJsonLayer(geojson, style);
    bindDataToClickEvent(lyr, data);
    layerGroup.addLayer(lyr);
    return lyr;
  }
  return null;
}

export async function addTileLayer(asset, layerGroup, options) {
  try {
    log(2, "add tile layer", asset);
    const href = asset.getAbsoluteUrl();
    const key = asset.getKey();
    const bounds = getBounds(asset, options);
    if (options.buildTileUrlTemplate) {
      const tileUrlTemplate = options.buildTileUrlTemplate({
        href,
        url: href,
        asset,
        key,
        stac: asset.getContext(),
        bounds,
        isCOG: asset.isCOG()
      });
      log(2, `built tile url template: "${tileUrlTemplate}"`);
      const tileLayerOptions = { ...options, url: href };
      const lyr = await tileLayer(tileUrlTemplate, bounds, tileLayerOptions);
      // todo: bands is all bands, not just the selected ones. correct?
      layerGroup.stac = { assets: [{ key, asset }], bands: asset.getBands() };
      bindDataToClickEvent(lyr, asset);
      layerGroup.addLayer(lyr);
      return lyr;
    } else if (options.tileUrlTemplate) {
      const tileLayerOptions = { ...options, url: encodeURIComponent(href) };
      const lyr = await tileLayer(options.tileUrlTemplate, bounds, tileLayerOptions);
      bindDataToClickEvent(lyr, asset);
      // todo: bands is all bands, not just the selected ones. correct?
      layerGroup.stac = { assets: [{ key, asset }], bands: asset.getBands() };
      layerGroup.addLayer(lyr);
      log(2, "added tile layer to layer group");
      return lyr;
    }
  } catch (error) {
    log(1, "caught the following error while trying to add a tile layer:", error);
    return null;
  }
};

export async function addAsset(asset, layerGroup, options) {
  log(2, "add asset", asset);
  if (asset.isGeoTIFF()) {
    return addGeoTiff(asset, layerGroup, options);
  }
  else {
    return addThumbnail([asset], layerGroup, options);
  }
}

export async function addDefaultGeoTiff(stac, layerGroup, options) {
  const geotiff = stac.getDefaultGeoTIFF(true, !options.displayGeoTiffByDefault);
  if (geotiff) {
    log(2, "add default geotiff", geotiff);
    return addGeoTiff(geotiff, layerGroup, options);
  }
  return null;
}

export async function addGeoTiff(asset, layerGroup, options) {
  if (options.preferTileLayer) {
    return addTileLayer(asset, layerGroup, options);
  }
  try {
    log(2, "add geotiff", asset);
    const href = asset.getAbsoluteUrl();
    const key = asset.getKey();
    log(2, "creating georaster layer for", href);
    const georasterLayer = await createGeoRasterLayer(href, options);
    options.alphas = await parseAlphas(georasterLayer.options.georaster);
    options.currentStats = georasterLayer.currentStats;
    log(1, "successfully created georaster layer for", asset);
    bindDataToClickEvent(georasterLayer, asset);
    // todo: bands is all bands, not just the selected ones. correct?
    layerGroup.stac = { assets: [{ key, asset }], bands: asset.getBands() };
    setFallback(georasterLayer, layerGroup, () => addTileLayer(asset, layerGroup, options));
    layerGroup.addLayer(georasterLayer);
    return georasterLayer;
  } catch (error) {
    log(1, "failed to create georaster layer because of the following error:", error);
    return null;
  }
};

export async function addThumbnails(stac, layerGroup, options) {
  const thumbnails = stac.getThumbnails(true, 'thumbnail');
  return await addThumbnail(thumbnails, layerGroup, options);
}

export async function addThumbnail(thumbnails, layerGroup, options) {
  if(thumbnails.length === 0) {
    return false;
  }
  const asset = thumbnails.shift(); // Try the first thumbnail
  log(2, "add thumbnail", asset);
  const bounds = getBounds(asset, options);
  if (!bounds) {
    throw new StacLayerError(
      "LocationMissing",
      "Can't visualize an asset without a location."
    );
  }

  const url = asset.getAbsoluteUrl();
  const lyr = await imageOverlay(url, bounds, options.crossOrigin);
  if (lyr === null) {
    log(1, "image layer is null", url);
    return addThumbnail(thumbnails, layerGroup, options); // Retry with the remaining thumbnails
  }
  layerGroup.addLayer(lyr);
  return new Promise((resolve, reject) => {
    lyr.on("load", () => {
      return resolve(lyr);
    });
    lyr.on("error", async () => {
      log(1, "create image layer errored", url);
      layerGroup.removeLayer(lyr);
      try {
        lyr = await addThumbnail(thumbnails, layerGroup, options); // Retry with the remaining thumbnails
        return resolve(lyr);
      } catch (error) {
        reject(error);
      }
    });
  })
}

export function getBounds(object, options) {
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