import { bindDataToClickEvent, log, setFallback, triggerEvent } from "./events.js";
import imageOverlay from "./utils/image-overlay.js";
import tileLayer from "./utils/tile-layer.js";
import createGeoRasterLayer from "./utils/create-georaster-layer.js";
import getBounds from "./utils/get-bounds.js";
import parseAlphas from "./utils/parse-alphas.js";
import { toGeoJSON } from "stac-js/src/geo.js";

export function addFootprintLayer(data, layerGroup, options) {
  // Add the geometry/bbox
  let geojson;
  if (data.isItemCollection() || data.isCollectionCollection()) {
    geojson = toGeoJSON(data.getBoundingBox());
  } else {
    geojson = data.toGeoJSON();
  }
  if (!geojson) {
    const bounds = getBounds(data, options);
    log(2, "No geojson found for footprint, falling back to bbox if available", bounds);
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
    const layer = L.geoJSON(geojson, style);
    bindDataToClickEvent(layer, data);
    layerGroup.addLayer(layer);
    triggerEvent("boundsLayerAdded", { layer, geojson }, layerGroup);
    return layer;
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
      const layer = await tileLayer(tileUrlTemplate, bounds, tileLayerOptions);
      bindDataToClickEvent(layer, asset);
      layerGroup.addLayer(layer);
      triggerEvent("imageLayerAdded", { type: "tilelayer", layer, asset }, layerGroup);
      return layer;
    } else if (options.tileUrlTemplate) {
      const tileLayerOptions = { ...options, url: encodeURIComponent(href) };
      const layer = await tileLayer(options.tileUrlTemplate, bounds, tileLayerOptions);
      bindDataToClickEvent(layer, asset);
      layerGroup.addLayer(layer);
      triggerEvent("imageLayerAdded", { type: "tilelayer", layer, asset }, layerGroup);
      log(2, "added tile layer to layer group");
      return layer;
    }
  } catch (error) {
    log(1, "caught the following error while trying to add a tile layer:", error);
    return null;
  }
}

export async function addAsset(asset, layerGroup, options) {
  log(2, "add asset", asset);
  if (asset.isGeoTIFF()) {
    return await addGeoTiff(asset, layerGroup, options);
  } else {
    return await addThumbnail([asset], layerGroup, options);
  }
}

export async function addDefaultGeoTiff(stac, layerGroup, options) {
  if (options.displayOverview) {
    const geotiff = stac.getDefaultGeoTIFF(true, !options.displayGeoTiffByDefault);
    if (geotiff) {
      log(2, "add default geotiff", geotiff);
      return addGeoTiff(geotiff, layerGroup, options);
    }
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
    log(2, "creating georaster layer for", href);
    const layer = await createGeoRasterLayer(href, options);
    options.alphas = await parseAlphas(layer.options.georaster);
    options.currentStats = layer.currentStats;
    log(1, "successfully created georaster layer for", asset);
    bindDataToClickEvent(layer, asset);
    setFallback(layer, layerGroup, () => addTileLayer(asset, layerGroup, options));
    layerGroup.addLayer(layer);
    triggerEvent("imageLayerAdded", { type: "overview", layer, asset }, layerGroup);
    return layer;
  } catch (error) {
    log(1, "failed to create georaster layer because of the following error:", error);
    return null;
  }
}

export async function addThumbnails(stac, layerGroup, options) {
  if (options.displayPreview) {
    const thumbnails = stac.getThumbnails(true, "thumbnail");
    return await addThumbnail(thumbnails, layerGroup, options);
  }
}

export async function addThumbnail(thumbnails, layerGroup, options) {
  if (thumbnails.length === 0) {
    return null;
  }
  try {
    const asset = thumbnails.shift(); // Try the first thumbnail
    log(2, "add thumbnail", asset);
    const bounds = getBounds(asset, options);
    if (!bounds) {
      log(1, "Can't visualize an asset without a location.");
      return null;
    }

    const url = asset.getAbsoluteUrl();
    const layer = await imageOverlay(url, bounds, options.crossOrigin);
    if (layer === null) {
      log(1, "image layer is null", url);
      return addThumbnail(thumbnails, layerGroup, options); // Retry with the remaining thumbnails
    }
    bindDataToClickEvent(layer, asset);
    layerGroup.addLayer(layer);
    return await new Promise(resolve => {
      layer.on("load", () => {
        triggerEvent("imageLayerAdded", { type: "preview", layer, asset }, layerGroup);
        return resolve(layer);
      });
      layer.on("error", async () => {
        log(1, "create image layer errored", url);
        layerGroup.removeLayer(layer);
        const otherLyr = await addThumbnail(thumbnails, layerGroup, options); // Retry with the remaining thumbnails
        return resolve(otherLyr);
      });
    });
  } catch (error) {
    log(1, "failed to create image layer because of the following error:", error);
    return null;
  }
}
