import L from "leaflet";
import bboxPolygon from "@turf/bbox-polygon";
import reprojectGeoJSON from "reproject-geojson";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

import bboxToLatLngBounds from "./utils/bboxToLatLngBounds.js";
import bboxLayer from "./utils/bboxLayer.js";
import imageOverlay from "./utils/image-overlay.js";
import tileLayer from "./utils/tile-layer.js";
import isBoundingBox from "./utils/is-bounding-box.js";
import getBoundingBox from "./utils/get-bounding-box.js";
import parseAlphas from "./utils/parse-alphas.js";
import createGeoRasterLayer from "./utils/create-georaster-layer.js";
import StacLayerError from "./utils/error.js";

import { canBrowserDisplayImage } from "stac-js/src/mediatypes.js";
import { default as createStacObject, STAC, Asset, Catalog, Collection, Item, ItemCollection } from 'stac-js';

// utility functions
// get asset extension, if type and if missing type or maybe throw an error
// that item is missing a type

const getLatLngBounds = item => {
  const bbox = getBoundingBox(item);
  if (bbox) return bboxToLatLngBounds(bbox);
  if (item.geometry) return L.geoJSON(item.geometry).getBounds();
};

function getDataType(data) {
  if (data instanceof ItemCollection) {
    return "Collection"; // Is this correct?
  } else if (data instanceof Asset || "href" in data) {
    return "Asset";
  } else if (data instanceof STAC) {
    return data.type;
  } else {
    return "Assets";
  }
}

async function addOverviewAssetForFeature(feature, layerGroup, crossOrigin, errorCallback) {
  if (!feature.isItem()) return;

  const asset = feature.getAssetWithRole('overview', true);
  if (asset && asset.canBrowserDisplayImage()) {
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
  if (!feature.isItem()) return;

  const asset = feature.getAssetWithRole('thumbnail', true);
  if (asset && asset.canBrowserDisplayImage()) {
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

const stacLayer = async (data, options = {}) => {
  const debugLevel = typeof options.debugLevel === "number" && options.debugLevel >= 1 ? options.debugLevel : 0;

  if (debugLevel >= 1) console.log("[stac-layer] starting");
  if (debugLevel >= 2) console.log("[stac-layer] data:", data);
  if (debugLevel >= 2) console.log("[stac-layer] options:", options);

  if (!(data instanceof STAC)) {
    data = createStacObject(data);
    if (options.baseUrl) {
      data.setAbsoluteUrl(options.baseUrl);
    }
  }
  if (debugLevel >= 2) console.log("[stac-layer] base url:", data.getAbsoluteUrl());

  const displayGeoTiffByDefault = (options.displayGeoTiffByDefault === true);
  if (debugLevel >= 2) console.log("[stac-layer] displayGeoTiffByDefault:", displayGeoTiffByDefault);

  const displayPreview = (options.displayPreview === true);
  if (debugLevel >= 2) console.log("[stac-layer] displayPreview:", displayPreview);

  const displayOverview = (options.displayOverview === true);
  if (debugLevel >= 2) console.log("[stac-layer] displayOverview:", displayOverview);

  const useTileLayer = options.tileUrlTemplate || options.buildTileUrlTemplate;
  const preferTileLayer = (useTileLayer && !options.useTileLayerAsFallback) || false;
  if (debugLevel >= 2) console.log("[stac-layer] preferTileLayer:", preferTileLayer);

  let assetsOption = [];
  if (Array.isArray(options.assets)) {
    assetsOption = options.assets.map(asset => {
      if (typeof asset === 'string') {
        asset = data.assets[asset];
      }
      return new Asset(asset, null, data)
    });
  }

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

  // default to filling in the bounds layer unless we successfully visualize an image
  let fillOpacity = 0.2;

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
      const clickedData = evt.stac.data;

      if (clickedData instanceof ItemCollection) {
        evt.stac.type = "Collection"; // Is this correct?
      } else if (clickedData instanceof Assets) {
        evt.stac.type = "Assets";
      } else if (clickedData instanceof Asset) {
        evt.stac.type = "Asset";
      } else {
        evt.stac.type = clickedData.type;
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

  if (data instanceof ItemCollection) {
    // Item Collection aka GeoJSON Feature Collection where each Feature is a STAC Item
    // STAC API /items endpoint also returns a similar Feature Collection
    const lyr = L.geoJSON(data.getGeoJSON(), options);

    data.features.forEach(f => {
      if (displayPreview) {
        const thumbnail = f.getAssetWithRole("thumbnail", true);
        const overview = f.getAssetWithRole("overview", true);
        // If we've got a thumnail asset add it
        if (thumbnail) {
          addThumbnailAssetForFeature(f, layerGroup, options.crossOrigin, () => {
            // If some reason it's broken try for an overview asset
            if (overview) {
              addOverviewAssetForFeature(f, layerGroup, options.crossOrigin);
            }
          });
        } else if (!thumbnail && overview) {
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
  } else if (data instanceof Item || data instanceof Collection) {
    let addedImagery = false;

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
            stac: data,
            bounds,
            isCOG,
            isVisual
          });
          if (debugLevel >= 2) console.log(`[stac-layer] built tile url template: "${tileUrlTemplate}"`);
          const tileLayerOptions = { bounds, ...options, url: href };
          const lyr = await tileLayer(tileUrlTemplate, tileLayerOptions);
          layerGroup.stac = { assets: [{ key, asset }], bands: asset.getBands() };
          bindDataToClickEvent(lyr, asset);
          layerGroup.addLayer(lyr);
          addedImagery = true;
        } else if (options.tileUrlTemplate) {
          const tileLayerOptions = { bounds, ...options, url: encodeURIComponent(href) };
          const lyr = await tileLayer(options.tileUrlTemplate, tileLayerOptions);
          bindDataToClickEvent(lyr, asset);
          layerGroup.stac = { assets: [{ key, asset }], bands: asset.getBands() };
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
      for (let asset of assetsOption) {
        if (!asset.isGeoTIFF()) {
          continue;
        }
        const href = asset.getAbsoluteHref();
        try {
          const georasterLayer = await createGeoRasterLayer(href, options);
          alphas = await parseAlphas(georasterLayer.options.georaster);
          currentStats = georasterLayer.currentStats;
          if (debugLevel >= 1) console.log("[stac-layer] successfully created layer for", asset);
          bindDataToClickEvent(georasterLayer, asset);
          layerGroup.stac = { assets: [{ asset }] };
          setFallback(georasterLayer, () => addTileLayer({ asset, href, isCOG: asset.isCOG(), isVisual: false }));
          layerGroup.addLayer(georasterLayer);
          addedImagery = true;
        } catch (error) {
          console.error("[stac-layer] failed to create georaster layer because of the following error:", error);
        }
      }
    }

    // then check for overview
    const overview = data.getAssetWithRole('overview', true);
    if (addedImagery === false && displayOverview && overview) {
      try {
        if (debugLevel >= 1) console.log(`[stac-layer] found image overview`);

        const asset = overview;
        const key = asset.getKey();
        const href = asset.getAbsoluteUrl();
        if (debugLevel >= 2) console.log("[stac-layer] overview's href is:", href);

        if (asset.canBrowserDisplayImage()) {
          const overviewLayer = await imageOverlay(href, bounds, options.crossOrigin);
          if (overviewLayer !== null) {
            bindDataToClickEvent(overviewLayer, asset);
            // there probably aren't eo:bands attached to an overview
            // but we include this here just in case
            layerGroup.stac = { assets: [{ key, asset }], bands: asset.getBands() };
            layerGroup.addLayer(overviewLayer);
            addedImagery = true;
            if (debugLevel >= 1) console.log("[stac-layer] succesfully added overview layer");
          }
        } else if (displayGeoTiffByDefault ? asset.isGeoTIFF() : asset.isCOG()) {
          const isCOG = asset.isCOG();
          if (preferTileLayer) {
            await addTileLayer({ asset, href, isCOG, isVisual: true, key });
          }

          if (!addedImagery) {
            try {
              const georasterLayer = await createGeoRasterLayer(href, options);
              alphas = await parseAlphas(georasterLayer.options.georaster);
              currentStats = georasterLayer.currentStats;
              bindDataToClickEvent(georasterLayer, asset);
              layerGroup.stac = { assets: [{ key, asset }], bands: asset.getBands() };
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
    const thumbnail = data.getAssetWithRole("thumbnail", true);
    if (addedImagery === false && displayPreview && thumbnail) {
      try {
        if (debugLevel >= 1) console.log(`[stac-layer] found image thumbnail`);
        if (thumbnail.canBrowserDisplayImage()) {
          const thumbLayer = await imageOverlay(thumbnail.getAbsoluteUrl(), bounds, options.crossOrigin);
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
    const preview = data.getLinkWithRel("preview");
    if (addedImagery === false && displayPreview && preview) {
      try {
        if (debugLevel >= 1) console.log(`[stac-layer] found image preview`);
        const { href } = data.toAbsolute(preview);

        if (canBrowserDisplayImage(preview)) {
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
    const visual = data.getAssetWithRole("visual", true);
    if (addedImagery === false && displayOverview && visual) {
      const asset = visual;
      const key = asset.getKey();
      if (displayGeoTiffByDefault ? asset.isGeoTIFF() : asset.isCOG()) {
        const isCOG = asset.isCOG();
        if (debugLevel >= 1) console.log(`[stac-layer] found visual asset, so displaying that`);
        const href = asset.getAbsoluteUrl();

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
            layerGroup.stac = { assets: [{ key, asset }], bands: asset.getBands() };
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
    const geotiffs = Object.entries(assets).filter(entry => displayGeoTiffByDefault ? entry[1].isGeoTIFF() : entry[1].isCOG());
    if (!addedImagery && geotiffs.length >= 1) {
      if (debugLevel >= 1)
        console.log(
          `[stac-layer] defaulting to trying to display the first ${displayGeoTiffByDefault ? "GeoTiff" : "COG"} asset`
        );
      const [key, asset] = geotiffs[0];
      const href = asset.getAbsoluteUrl();
      const isCOG = asset.isCOG();

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
          layerGroup.stac = { assets: [{ key, asset }], bands: asset.getBands() };
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

    if (data instanceof Item) {
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
    } else if (data instanceof Collection) {
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
  } else if (data instanceof Asset) {
    const href = data.getAbsoluteUrl();
    let bounds;
    if (options.latLngBounds) {
      bounds = options.latLngBounds;
    } else if (options.bounds) {
      bounds = options.bounds;
    } else if (options.bbox) {
      bounds = bboxToLatLngBounds(options.bbox);
    }

    if (debugLevel >= 1) console.log("[stac-layer] visualizing " + data.type);
    if (data.canBrowserDisplayImage()) {
      if (!bounds) {
        throw new StacLayerError(
          "LocationMissing",
          `Can't visualize an asset of type "${data.type}" without a location.`,
          {type: data.type}
        );
      }

      const lyr = await imageOverlay(href, bounds, options.crossOrigin);
      if (lyr !== null) {
        bindDataToClickEvent(lyr);
        layerGroup.addLayer(lyr);
        fillOpacity = 0;
      }
    } else if (data.isGeoTIFF()) {
      const addTileLayer = async () => {
        try {
          if (options.buildTileUrlTemplate) {
            const tileUrlTemplate = options.buildTileUrlTemplate({
              href,
              url: href,
              asset: data,
              key: null,
              stac: null,
              isCOG: data.isCOG(),
              isVisual: null
            });
            if (debugLevel >= 2) console.log(`[stac-layer] built tile url template: "${tileUrlTemplate}"`);
            const tileLayerOptions = { ...options, bounds, url: href };
            const lyr = await tileLayer(tileUrlTemplate, tileLayerOptions);
            layerGroup.stac = { assets: [{ key: null, asset: data }], bands: data.getBands() };
            bindDataToClickEvent(lyr);
            layerGroup.addLayer(lyr);
            fillOpacity = 0;
          } else if (options.tileUrlTemplate) {
            const tileLayerOptions = { bounds, ...options, url: href };
            const lyr = await tileLayer(options.tileUrlTemplate, tileLayerOptions);
            layerGroup.stac = { assets: [{ key: null, asset: data }], bands: data.getBands() };
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
            layerGroup.stac = { assets: [{ key: null, asset: data }], bands: data.getBands() };
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
    throw new StacLayerError(
      "FormatNotSupported",
      `Visualizing data of the type "${dataType}" is not supported`,
      {dataType}
    );
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
