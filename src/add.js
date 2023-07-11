import reprojectBoundingBox from "reproject-bbox";
import { log, onLayerGroupClick, triggerEvent } from "./events.js";
import imageOverlay from "./utils/image-overlay.js";
import tileLayer from "./utils/tile-layer.js";
import createGeoRasterLayer from "./utils/create-georaster-layer.js";
import getBounds from "./utils/get-bounds.js";
import parseAlphas from "./utils/parse-alphas.js";
import { toGeoJSON } from "stac-js/src/geo.js";
import { CollectionCollection, ItemCollection, STAC } from "stac-js";
import withTimeout, { TIMEOUT } from "./utils/with-timeout.js";

export function addLayer(layer, layerGroup, data) {
  layer.stac = data;
  layer.on("click", evt => onLayerGroupClick(evt, layerGroup));
  layerGroup.addLayer(layer);
}

function getGeoJson(data, options) {
  // Add the geometry/bbox
  let geojson = null;
  if (data instanceof ItemCollection || data instanceof CollectionCollection) {
    geojson = toGeoJSON(data.getBoundingBox());
  } else if (data instanceof STAC) {
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
  return geojson;
}

export function addFootprintLayer(data, layerGroup, options) {
  let geojson = getGeoJson(data, options);
  if (geojson) {
    log(1, "adding footprint layer");
    const layer = L.geoJSON(geojson);
    addLayer(layer, layerGroup, data);
    layerGroup.footprintLayer = layer;
    setFootprintLayerStyle(layerGroup, options);
    layerGroup.on("imageLayerAdded", () => setFootprintLayerStyle(layerGroup, options));
    return layer;
  }
  return null;
}

export function setFootprintLayerStyle(layerGroup, options) {
  let style = {};
  if (layerGroup.getLayers().length > 1) {
    style.fillOpacity = 0;
  }
  style = Object.assign({}, options.boundsStyle, style);
  layerGroup.footprintLayer.setStyle(style);
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
      addLayer(layer, layerGroup, asset);
      triggerEvent("imageLayerAdded", { type: "tilelayer", layer, asset }, layerGroup);
      return layer;
    } else if (options.tileUrlTemplate) {
      const tileLayerOptions = { ...options, url: encodeURIComponent(href) };
      const layer = await tileLayer(options.tileUrlTemplate, bounds, tileLayerOptions);
      addLayer(layer, layerGroup, asset);
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
  return new Promise(async (resolve) => {
    if (options.preferTileLayer) {
      return resolve(await addTileLayer(asset, layerGroup, options));
    }

    const fallback = async (error) => {
      log(1, `activating fallback because "${error.message}"`);
      triggerEvent("fallback", { asset, error }, layerGroup);
      return await addTileLayer(asset, layerGroup, options); 
    };

    try {
      log(2, "add geotiff", asset);

      const layer = await createGeoRasterLayer(asset, options);
      const georaster = layer.options.georaster;
      options.alphas = await parseAlphas(georaster);
      options.currentStats = layer.currentStats;
      log(1, "successfully created georaster layer for", asset);

      if (!layerGroup.footprintLayer) {
        try {
          let bbox = [georaster.xmin, georaster.ymin, georaster.xmax, georaster.ymax];
          options.bbox = reprojectBoundingBox({ bbox, from: georaster.projection, to: 4326, density: 100 });
          addFootprintLayer(asset, layerGroup, options);
        } catch (error) {
          console.trace(error);
        }
      }

      let count = 0;
      layer.on("tileerror", async (event) => {
        // sometimes LeafletJS might issue multiple error events before the layer is removed from the map.
        // the counter makes sure we only active the fallback sequence once
        count++;
        if (count === 1) {
          if (layerGroup.hasLayer(layer)) {
            layerGroup.removeLayer(layer);
          }
          resolve(await fallback(event.error));
        }
      });
      layer.on("load", () => resolve(layer));
      addLayer(layer, layerGroup, asset);

      triggerEvent("imageLayerAdded", { type: "overview", layer, asset }, layerGroup);
      // Make sure resolve is always called
      withTimeout(TIMEOUT, () => resolve(layer));
    } catch (error) {
      resolve(await fallback(error));
    }
  });
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
    addLayer(layer, layerGroup, asset);
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
