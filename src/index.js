import L from "leaflet";
import bboxPolygon from "@turf/bbox-polygon";
import reprojectGeoJSON from "reproject-geojson";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import URI from "urijs";

import bboxToLatLngBounds from "./utils/bboxToLatLngBounds.js";
import bboxLayer from "./utils/bboxLayer.js";
import findAsset from "./utils/find-asset.js";
import imageOverlay from "./utils/image-overlay.js";
import tileLayer from "./utils/tile-layer.js";
import isBoundingBox from "./utils/is-bounding-box.js";
import getBoundingBox from "./utils/get-bounding-box.js";
import parseAlphas from "./utils/parse-alphas.js";
import { DATA_TYPES, EVENT_DATA_TYPES, MIME_TYPES } from "./data.js";
import createGeoRasterLayer from "./utils/create-georaster-layer.js";

// utility functions
// get asset extension, if type and if missing type or maybe throw an error
// that item is missing a type

const isImageType = type => MIME_TYPES.BROWSER.includes(type);
const isAssetCOG = asset => isAssetGeoTiff(asset, true);
const isAssetGeoTiff = (asset, cloudOptimized = false) => {
  let types = cloudOptimized ? MIME_TYPES.COG : MIME_TYPES.GEOTIFF;
  return types.includes(asset.type) && typeof asset.href === "string" && asset.href.length > 0;
};

const getOverviewAsset = assets => findAsset(assets, "overview");
const hasAsset = (assets, key) => !!findAsset(assets, key);

const findLinks = data => {
  if (Array.isArray(data)) return data;
  else if (data.links) return data.links;
};

const findLink = (data, key) => {
  const links = findLinks(data);
  key = key.toLowerCase();
  if (links) return links.find(ln => typeof ln === "object" && ln.rel.toLowerCase() === key);
};

const hasLink = (data, key) => !!findLink(data, key);

const findSelf = data => findLink(data, "self");
const findSelfHref = data => findSelf(data)?.href;

const getLatLngBounds = item => {
  const bbox = getBoundingBox(item);
  if (bbox) return bboxToLatLngBounds(bbox);
  if (item.geometry) return L.geoJSON(item.geometry).getBounds();
};

function getDataType(data) {
  if (typeof data.type === "string") {
    const dataType = data.type.toUpperCase();
    if (dataType === "CATALOG") {
      return DATA_TYPES.STAC_CATALOG;
    } else if (dataType === "FEATURECOLLECTION") {
      return DATA_TYPES.ITEM_COLLECTION;
    } else if (dataType === "COLLECTION") {
      return DATA_TYPES.STAC_COLLECTION;
    } else if (dataType === "FEATURE") {
      return DATA_TYPES.STAC_ITEM;
    }
  }

  if ("href" in data) {
    return DATA_TYPES.STAC_ASSET;
  }
  if (Array.isArray(data) && data.every(it => "href" in it)) {
    return DATA_TYPES.STAC_ASSETS;
  }
  if ("license" in data && "extent" in data) {
    return DATA_TYPES.STAC_COLLECTION;
  } else {
    return DATA_TYPES.STAC_CATALOG;
  }
}

async function addOverviewAssetForFeature(feature, layerGroup, crossOrigin, errorCallback) {
  if (!("bbox" in feature)) return;

  const { asset } = getOverviewAsset(feature.assets);
  if (isImageType(asset.type)) {
    const lyr = await imageOverlay(
      asset.href,
      [
        [feature.bbox[1], feature.bbox[0]],
        [feature.bbox[3], feature.bbox[2]]
      ],
      crossOrigin
    );
    if (lyr === null) {
      if (errorCallback) errorCallback();
      return;
    }
    layerGroup.addLayer(lyr);
    lyr.on("error", () => {
      layerGroup.removeLayer(lyr);
      if (errorCallback) errorCallback();
    });
  }
}

async function addThumbnailAssetForFeature(feature, layerGroup, crossOrigin, errorCallback) {
  if (!("bbox" in feature)) return;

  const { asset } = findAsset(feature.assets, "thumbnail");
  if (isImageType(asset.type)) {
    const lyr = await imageOverlay(
      asset.href,
      [
        [feature.bbox[1], feature.bbox[0]],
        [feature.bbox[3], feature.bbox[2]]
      ],
      crossOrigin
    );
    if (lyr === null) {
      if (errorCallback) errorCallback();
      return;
    }
    layerGroup.addLayer(lyr);
    lyr.on("error", () => {
      layerGroup.removeLayer(lyr);
      if (errorCallback) errorCallback();
    });
  }
}

// relevant links:
// https://github.com/radiantearth/stac-browser/blob/v3/src/stac.js
const stacLayer = async (data, options = {}) => {
  const debugLevel = typeof options.debugLevel === "number" && options.debugLevel >= 1 ? options.debugLevel : 0;

  if (debugLevel >= 1) console.log("[stac-layer] starting");
  if (debugLevel >= 2) console.log("[stac-layer] data:", data);
  if (debugLevel >= 2) console.log("[stac-layer] options:", options);

  const displayGeoTiffByDefault = [true, false].includes(options.displayGeoTiffByDefault)
    ? options.displayGeoTiffByDefault
    : false;
  if (debugLevel >= 2) console.log("[stac-layer] displayGeoTiffByDefault:", displayGeoTiffByDefault);

  const displayPreview = [true, false].includes(options.displayPreview) ? options.displayPreview : false;
  if (debugLevel >= 2) console.log("[stac-layer] displayPreview:", displayPreview);

  const displayOverview = [true, false].includes(options.displayOverview) ? options.displayOverview : true;
  if (debugLevel >= 2) console.log("[stac-layer] displayOverview:", displayOverview);

  const useTileLayer = options.tileUrlTemplate || options.buildTileUrlTemplate;
  const preferTileLayer = (useTileLayer && !options.useTileLayerAsFallback) || false;
  if (debugLevel >= 2) console.log("[stac-layer] preferTileLayer:", preferTileLayer);

  let assetsOption = options.assets ? options.assets : [];
  assetsOption = Array.isArray(assetsOption) ? assetsOption : [assetsOption];

  let currentStats, alphas;
  if (Array.isArray(options.bands)) {
    options = { ...options }; // shallow clone options
    options.calcStats = true;
    options.pixelValuesToColorFn = values => {
      const { mins, maxs, ranges } = currentStats;
      const fitted = values.map((v, i) => {
        if (alphas[i]) {
          const { int, min, range } = alphas[i];
          if (int) {
            return Math.round((255 * (v - min)) / range);
          } else {
            const currentMin = Math.min(v, mins[i]);
            const currentMax = Math.max(v, maxs[i]);
            if (currentMin >= 0 && currentMax <= 1) {
              return Math.round(255 * v);
            } else if (currentMin >= 0 && currentMax <= 100) {
              return Math.round((255 * v) / 100);
            } else if (currentMin >= 0 && currentMax <= 255) {
              return Math.round(v);
            } else if (currentMin === currentMax) {
              return 255;
            } else {
              return Math.round((255 * (v - Math.min(v, min))) / range);
            }
          }
        } else {
          return Math.round((255 * (v - Math.min(v, mins[i]))) / ranges[i]);
        }
      });
      const mapped = options.bands.map(bandIndex => fitted[bandIndex]);
      const [r, g, b, a = 255] = mapped;
      return `rgba(${r},${g},${b},${a / 255})`;
    };
  }

  // get link to self, which we might need later
  const selfHref = findSelfHref(data);
  if (debugLevel >= 2) console.log("[stac-layer] self href:", selfHref);

  let baseUrl = options.baseUrl || selfHref;
  if (debugLevel >= 2) console.log("[stac-layer] base url:", baseUrl);

  // default to filling in the bounds layer unless we successfully visualize an image
  let fillOpacity = 0.2;

  const toAbsoluteHref = href => {
    if (!href) {
      throw new Error("[stac-layer] can't convert nothing to an absolute href");
    }
    let uri = URI(href);
    if (uri.is("relative")) {
      if (!baseUrl) {
        throw new Error(`[stac-layer] can't determine an absolute url for "${href}" without a baseUrl`);
      }
      uri = uri.absoluteTo(baseUrl);
    }
    return uri.toString();
  };

  const layerGroup = L.layerGroup();

  // if the given layer fails for any reason, remove it from the map, and call the fallback
  const setFallback = (lyr, fallback) => {
    let count = 0;
    ["tileerror"].forEach(name => {
      lyr.on(name, async evt => {
        count++;
        // sometimes LeafletJS might issue multiple error events before
        // the layer is removed from the map
        // the following makes sure we only active the fallback sequence once
        if (count === 1) {
          console.log(`[stac-layer] activating fallback because "${evt.error.message}"`);
          if (layerGroup.hasLayer(lyr)) layerGroup.removeLayer(lyr);
          await fallback();
          onFallbackHandlers.forEach(handleOnFallback => {
            try {
              handleOnFallback({ error: evt });
            } catch (error) {
              console.error(error);
            }
          });
        }
      });
    });
  };

  // hijack on event to support on("click") as it isn't normally supported by layer groups
  const onClickHandlers = [];
  const onFallbackHandlers = [];
  layerGroup.on2 = layerGroup.on;
  layerGroup.on = function (name, callback) {
    if (name === "click") {
      onClickHandlers.push(callback);
      return this;
    } else if (name === "fallback") {
      onFallbackHandlers.push(callback);
      return this;
    } else if (this.on2) {
      return this.on2(...arguments);
    }
  };

  const dataType = getDataType(data);
  if (debugLevel >= 1) console.log(`[stac-layer] data is of type "${dataType}"`);

  // sets up generic onClick event where a "stac" key is added to the event object
  // and is set to the provided data or the data used to create stacLayer
  const bindDataToClickEvent = (lyr, _data) => {
    lyr.on("click", evt => {
      evt.stac = { data: typeof _data === "function" ? _data(evt) : _data || data };
      const clickedDataType = getDataType(evt.stac.data);
      if (
        [
          DATA_TYPES.STAC_COLLECTION,
          DATA_TYPES.STAC_API_COLLECTIONS,
          DATA_TYPES.ITEM_COLLECTION,
          DATA_TYPES.STAC_API_ITEMS
        ].includes(clickedDataType)
      ) {
        evt.stac.type = EVENT_DATA_TYPES.COLLECTION;
      } else if ([DATA_TYPES.STAC_ITEM].includes(clickedDataType)) {
        evt.stac.type = EVENT_DATA_TYPES.FEATURE;
      } else if ([DATA_TYPES.STAC_ASSETS].includes(clickedDataType)) {
        evt.stac.type = EVENT_DATA_TYPES.ASSETS;
      } else if ([DATA_TYPES.STAC_ASSET].includes(clickedDataType)) {
        evt.stac.type = EVENT_DATA_TYPES.ASSET;
      }
      onClickHandlers.forEach(handleOnClick => {
        try {
          handleOnClick(evt);
        } catch (error) {
          console.error(error);
        }
      });
    });
  };

  if (dataType === DATA_TYPES.ITEM_COLLECTION || dataType === DATA_TYPES.STAC_API_ITEMS) {
    // Item Collection aka GeoJSON Feature Collection where each Feature is a STAC Item
    // STAC API /items endpoint also returns a similar Feature Collection
    const lyr = L.geoJSON(data, options);

    data.features.forEach(f => {
      if (displayPreview) {
        // If we've got a thumnail asset add it
        if (hasAsset(f.assets, "thumbnail")) {
          addThumbnailAssetForFeature(f, layerGroup, options.crossOrigin, () => {
            // If some reason it's broken try for an overview asset
            if (hasAsset(f.assets, "overview")) {
              addOverviewAssetForFeature(f, layerGroup, options.crossOrigin);
            }
          });
        } else if (!hasAsset(f.assets, "thumbnail") && hasAsset(f.assets, "overview")) {
          // If we don't have a thumbail let's try for an overview asset
          addOverviewAssetForFeature(f, layerGroup, options.crossOrigin);
        }
      }
    });
    bindDataToClickEvent(lyr, e => {
      try {
        const { lat, lng } = e.latlng;
        const point = [lng, lat];
        const matches = data.features.filter(feature => booleanPointInPolygon(point, feature));
        if (matches.length >= 2) {
          return {
            type: "FeatureCollection",
            features: matches
          };
        }
      } catch (error) {
        // code above failed, so just skip intersection checks
        // and return feature given by LeafletJS event
      }
      return e?.layer?.feature;
    });
    layerGroup.addLayer(lyr);
  } else if (dataType === DATA_TYPES.STAC_ITEM || dataType === DATA_TYPES.STAC_COLLECTION) {
    let addedImagery = false;

    const { assets = {} } = data;

    const bounds = getLatLngBounds(data);
    if (debugLevel >= 1) console.log(`[stac-layer] item bounds are: ${bounds.toBBoxString()}`);

    const addTileLayer = async ({ asset, href, isCOG, isVisual, key }) => {
      try {
        if (options.buildTileUrlTemplate) {
          const tileUrlTemplate = options.buildTileUrlTemplate({
            href,
            url: href,
            asset,
            key,
            item: asset,
            bounds,
            isCOG,
            isVisual
          });
          if (debugLevel >= 2) console.log(`[stac-layer] built tile url template: "${tileUrlTemplate}"`);
          const tileLayerOptions = { bounds, ...options, url: href };
          const lyr = await tileLayer(tileUrlTemplate, tileLayerOptions);
          layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
          bindDataToClickEvent(lyr, asset);
          layerGroup.addLayer(lyr);
          addedImagery = true;
        } else if (options.tileUrlTemplate) {
          const tileLayerOptions = { bounds, ...options, url: encodeURIComponent(href) };
          const lyr = await tileLayer(options.tileUrlTemplate, tileLayerOptions);
          bindDataToClickEvent(lyr, asset);
          layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
          layerGroup.addLayer(lyr);
          if (debugLevel >= 2) console.log("[stac-layer] added tile layer to layer group");
          addedImagery = true;
        }
      } catch (error) {
        console.log("[stac-layer] caught the following error while trying to add a tile layer:", error);
      }
    };

    // first, check if we're supposed to be showing a particular asset
    if (assetsOption.length > 0) {
      for (let index = 0; index < assetsOption.length; index++) {
        const assetThing = assetsOption[index];
        // Handle asset key strings and objects
        const asset = typeof assetThing === "string" ? assets[assetThing] : assetThing;

        if (asset !== undefined && isAssetGeoTiff(asset)) {
          const href = toAbsoluteHref(asset.href);
          try {
            const georasterLayer = await createGeoRasterLayer(href, options);
            alphas = await parseAlphas(georasterLayer.options.georaster);
            currentStats = georasterLayer.currentStats;
            if (debugLevel >= 1) console.log("[stac-layer] successfully created layer for", asset);
            bindDataToClickEvent(georasterLayer, asset);
            layerGroup.stac = { assets: [{ asset }] };
            setFallback(georasterLayer, () => addTileLayer({ asset, href, isCOG: isAssetCOG(asset), isVisual: false }));
            layerGroup.addLayer(georasterLayer);
            addedImagery = true;
          } catch (error) {
            console.error("[stac-layer] failed to create georaster layer because of the following error:", error);
          }
        }
      }
    }

    // then check for overview
    if (addedImagery === false && displayOverview && hasAsset(assets, "overview")) {
      try {
        if (debugLevel >= 1) console.log(`[stac-layer] found image overview`);

        const { key, asset } = getOverviewAsset(assets);
        const { type } = asset;
        const href = toAbsoluteHref(asset.href);
        if (debugLevel >= 2) console.log("[stac-layer] overview's href is:", href);

        if (isImageType(type)) {
          const overviewLayer = await imageOverlay(href, bounds, options.crossOrigin);
          if (overviewLayer !== null) {
            bindDataToClickEvent(overviewLayer, asset);
            // there probably aren't eo:bands attached to an overview
            // but we include this here just in case
            layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
            layerGroup.addLayer(overviewLayer);
            addedImagery = true;
            if (debugLevel >= 1) console.log("[stac-layer] succesfully added overview layer");
          }
        } else if (isAssetGeoTiff(asset, !displayGeoTiffByDefault)) {
          const isCOG = isAssetCOG(asset);
          if (preferTileLayer) {
            await addTileLayer({ asset, href, isCOG, isVisual: true, key });
          }

          if (!addedImagery) {
            try {
              const georasterLayer = await createGeoRasterLayer(href, options);
              alphas = await parseAlphas(georasterLayer.options.georaster);
              currentStats = georasterLayer.currentStats;
              bindDataToClickEvent(georasterLayer, asset);
              layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
              setFallback(georasterLayer, () => addTileLayer({ asset, href, isCOG, isVisual: true, key }));
              layerGroup.addLayer(georasterLayer);
              addedImagery = true;
            } catch (error) {
              "[stac-layer] failed to create georaster layer because of the following error:", error;
            }
          }

          if (!preferTileLayer && useTileLayer) {
            await addTileLayer({ asset, href, isCOG, isVisual: true, key });
          }
        }
      } catch (error) {
        if (debugLevel >= 1)
          console.log(`[stac-layer] caught the following error while trying to render the overview`, error);
      }
    }

    // check for thumbnail
    if (addedImagery === false && displayPreview && hasAsset(assets, "thumbnail")) {
      try {
        if (debugLevel >= 1) console.log(`[stac-layer] found image thumbnail`);
        const { key, asset } = findAsset(assets, "thumbnail");
        const { type } = asset;
        const href = toAbsoluteHref(asset.href);

        if (isImageType(type)) {
          const thumbLayer = await imageOverlay(href, bounds, options.crossOrigin);
          if (thumbLayer !== null) {
            bindDataToClickEvent(thumbLayer, data);
            layerGroup.addLayer(thumbLayer);
            addedImagery = true;
            if (debugLevel >= 1) console.log("[stac-layer] succesfully added thumbnail layer");
          }
        }
      } catch (error) {
        if (debugLevel >= 1)
          console.log(`[stac-layer] caught the following error while trying to render the thumbnail`, error);
      }
    }

    // check for preview image
    if (addedImagery === false && displayPreview && hasLink(data, "preview")) {
      try {
        if (debugLevel >= 1) console.log(`[stac-layer] found image preview`);
        const preview = findLink(data, "preview");
        const { type } = preview;
        const href = toAbsoluteHref(preview.href);

        if (isImageType(type)) {
          const previewLayer = await imageOverlay(href, bounds, options.crossOrigin);
          if (previewLayer !== null) {
            bindDataToClickEvent(previewLayer, data);
            layerGroup.addLayer(previewLayer);
            addedImagery = true;
            if (debugLevel >= 1) console.log("[stac-layer] succesfully added preview layer");
          }
        }
      } catch (error) {
        if (debugLevel >= 1)
          console.log(`[stac-layer] caught the following error while trying to render the preview`, error);
      }
    }

    // check for non-standard asset with the key "visual"
    if (addedImagery === false && displayOverview && hasAsset(assets, "visual")) {
      const { asset, key } = findAsset(assets, "visual");
      if (isAssetGeoTiff(asset, !displayGeoTiffByDefault)) {
        const isCOG = isAssetCOG(asset);
        if (debugLevel >= 1) console.log(`[stac-layer] found visual asset, so displaying that`);
        const href = toAbsoluteHref(asset.href);

        if (preferTileLayer) {
          await addTileLayer({ asset, href, isCOG, isVisual: true, key });
        }

        if (addedImagery === false) {
          try {
            const georasterLayer = await createGeoRasterLayer(href, {
              ...options,
              debugLevel: (options.debugLevel || 1) - 1
            });
            alphas = await parseAlphas(georasterLayer.options.georaster);
            currentStats = georasterLayer.currentStats;
            layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
            bindDataToClickEvent(georasterLayer, asset);
            setFallback(georasterLayer, () => addTileLayer({ asset, href, isCOG, isVisual: true, key }));
            layerGroup.addLayer(georasterLayer);
            addedImagery = true;
          } catch (error) {
            console.error("[stac-layer] failed to create georaster layer because of the following error:", error);
          }
        }

        if (addedImagery === false && !preferTileLayer && useTileLayer) {
          await addTileLayer({ asset, href, isCOG, isVisual: true, key });
        }
      }
    }

    // if we still haven't found a valid imagery layer yet, just add the first GeoTiff (or COG)
    const geotiffs = Object.entries(assets).filter(entry => isAssetGeoTiff(entry[1], !displayGeoTiffByDefault));
    if (!addedImagery && geotiffs.length >= 1) {
      if (debugLevel >= 1)
        console.log(
          `[stac-layer] defaulting to trying to display the first ${displayGeoTiffByDefault ? "GeoTiff" : "COG"} asset`
        );
      const [key, asset] = geotiffs[0];
      const href = toAbsoluteHref(asset.href);
      const isCOG = isAssetCOG(asset);

      if (preferTileLayer) {
        await addTileLayer({ asset, href, isCOG, isVisual: false, key });
      }

      if (!addedImagery) {
        try {
          const georasterLayer = await createGeoRasterLayer(href, options);
          alphas = await parseAlphas(georasterLayer.options.georaster);
          currentStats = georasterLayer.currentStats;
          if (debugLevel >= 1) console.log("[stac-layer] successfully created layer for", asset);
          bindDataToClickEvent(georasterLayer, asset);
          layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
          setFallback(georasterLayer, () => addTileLayer({ asset, href, isCOG, isVisual: false, key }));
          layerGroup.addLayer(georasterLayer);
          addedImagery = true;
        } catch (error) {
          console.error("[stac-layer] failed to create georaster layer because of the following error:", error);
        }
      }

      if (addedImagery === false && !preferTileLayer && useTileLayer) {
        await addTileLayer({ asset, href, isCOG, isVisual: false, key });
      }
    }

    if (dataType === DATA_TYPES.STAC_ITEM) {
      if ("geometry" in data && typeof data.geometry === "object") {
        const lyr = L.geoJSON(data.geometry, {
          fillOpacity: layerGroup.getLayers().length > 0 ? 0 : 0.2,
          ...options
        });
        bindDataToClickEvent(lyr);
        layerGroup.addLayer(lyr);
      } else if ("bbox" in data && Array.isArray(data.bbox) && data.bbox.length === 4) {
        const lyr = L.bboxLayer(data, {
          fillOpacity: layerGroup.getLayers().length > 0 ? 0 : 0.2,
          ...options
        });
        bindDataToClickEvent(lyr);
        layerGroup.addLayer(lyr);
      }
    } else if (dataType === DATA_TYPES.STAC_COLLECTION) {
      const bbox = data?.extent?.spatial?.bbox;
      if (isBoundingBox(bbox)) {
        const lyr = bboxLayer(bbox, options);
        bindDataToClickEvent(lyr);
        layerGroup.addLayer(lyr);
      } else if (Array.isArray(bbox) && bbox.length === 1 && isBoundingBox(bbox[0])) {
        const lyr = bboxLayer(bbox[0], options);
        bindDataToClickEvent(lyr);
        layerGroup.addLayer(lyr);
      } else if (Array.isArray(bbox) && bbox.length >= 2) {
        const layers = bbox.slice(1).map(it => {
          const lyr = bboxLayer(it, options);
          // could we use turf to filter features by bounding box clicked
          // or is that over-engineering?
          bindDataToClickEvent(lyr);
          return lyr;
        });
        const featureGroup = L.featureGroup(layers);
        layerGroup.addLayer(featureGroup);
      }
    }
  } else if (dataType === DATA_TYPES.STAC_ASSET) {
    const { type } = data;
    const href = toAbsoluteHref(data.href);
    let bounds;
    if (options.latLngBounds) {
      bounds = options.latLngBounds;
    } else if (options.bounds) {
      bounds = options.bounds;
    } else if (options.bbox) {
      bounds = bboxToLatLngBounds(options.bbox);
    }

    if (debugLevel >= 1) console.log("[stac-layer] visualizing " + type);
    if (isImageType(type)) {
      if (!bounds) {
        throw new Error(
          `[stac-layer] cannot visualize asset of type "${type}" without a location.  Please pass in an options object with bounds or bbox set.`
        );
      }

      const lyr = await imageOverlay(href, bounds, options.crossOrigin);
      if (lyr !== null) {
        bindDataToClickEvent(lyr);
        layerGroup.addLayer(lyr);
        fillOpacity = 0;
      }
    } else if (MIME_TYPES.GEOTIFF.includes(type)) {
      const addTileLayer = async () => {
        try {
          if (options.buildTileUrlTemplate) {
            const tileUrlTemplate = options.buildTileUrlTemplate({
              href,
              url: href,
              asset: data,
              key: null,
              item: null,
              isCOG: MIME_TYPES.COG.includes(type),
              isVisual: null
            });
            if (debugLevel >= 2) console.log(`[stac-layer] built tile url template: "${tileUrlTemplate}"`);
            const tileLayerOptions = { ...options, bounds, url: href };
            const lyr = await tileLayer(tileUrlTemplate, tileLayerOptions);
            layerGroup.stac = { assets: [{ key: null, asset: data }], bands: data?.["eo:bands"] };
            bindDataToClickEvent(lyr);
            layerGroup.addLayer(lyr);
            fillOpacity = 0;
          } else if (options.tileUrlTemplate) {
            const tileLayerOptions = { bounds, ...options, url: href };
            const lyr = await tileLayer(options.tileUrlTemplate, tileLayerOptions);
            layerGroup.stac = { assets: [{ key: null, asset: data }], bands: data?.["eo:bands"] };
            bindDataToClickEvent(lyr);
            layerGroup.addLayer(lyr);
            fillOpacity = 0;
          }
        } catch (error) {
          console.log("[stac-layer] caught the following error while trying to add a tile layer:", error);
        }
      };

      if (preferTileLayer) {
        await addTileLayer();
      } else {
        try {
          try {
            const georasterLayer = await createGeoRasterLayer(href, options);
            const georaster = georasterLayer.options.georaster;
            alphas = await parseAlphas(georaster);
            // save current stats object for use in pixelValuesToColorFn
            currentStats = georasterLayer.currentStats;
            layerGroup.stac = { assets: [{ key: null, asset: data }], bands: data?.["eo:bands"] };
            bindDataToClickEvent(georasterLayer);
            setFallback(georasterLayer, addTileLayer);
            layerGroup.addLayer(georasterLayer);
            const bbox = [georaster.xmin, georaster.ymin, georaster.xmax, georaster.ymax];
            bounds = reprojectGeoJSON(bboxPolygon(bbox), { from: georaster.projection, to: 4326 });
          } catch (error) {
            console.log("we encountered the following error while trying create a GeoRasterLayer", error);
            if (useTileLayer) await addTileLayer();
          }

          fillOpacity = 0;
        } catch (error) {
          console.error("caught error so checking geometry:", error);
        }
      }
    }

    if (bounds) {
      if (debugLevel >= 1) console.log("[stac-layer] adding bounds layer");
      let lyr;
      if (bounds.type === "Feature") {
        lyr = L.geoJSON(bounds, { fillOpacity });
      } else {
        lyr = L.rectangle(bounds, { fillOpacity });
      }
      bindDataToClickEvent(lyr);
      layerGroup.addLayer(lyr);
    }
  } else {
    throw new Error(`[stac-layer] does not support visualization of data of the type "${dataType}"`);
  }

  // use the extent of the vector layer
  layerGroup.getBounds = () => {
    const lyr = layerGroup.getLayers().find(lyr => lyr.toGeoJSON);
    if (!lyr) {
      if (layerGroup.options.debugLevel >= 1) {
        console.log(
          "[stac-layer] unable to get bounds without a vector layer. " +
            "This often happens when there was an issue determining the bounding box of the provided data."
        );
      }
      return;
    }
    const bounds = lyr.getBounds();
    const southWest = [bounds.getSouth(), bounds.getWest()];
    const northEast = [bounds.getNorth(), bounds.getEast()];
    return [southWest, northEast];
  };
  layerGroup.bringToFront = () => layerGroup.getLayers().forEach(layer => layer.bringToFront());
  layerGroup.bringToBack = () => layerGroup.getLayers().forEach(layer => layer.bringToBack());

  if (!layerGroup.options) layerGroup.options = {};

  layerGroup.options.debugLevel = debugLevel;

  return layerGroup;
};

L.stacLayer = stacLayer;

export default stacLayer;
