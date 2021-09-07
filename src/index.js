import L from "leaflet";
import parseGeoRaster from "georaster";
import GeoRasterLayer from "georaster-layer-for-leaflet";
import getDepth from "get-depth";
import reprojectBoundingBox from "reproject-bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

import bboxToLatLngBounds from "./utils/bboxToLatLngBounds.js";
import bboxLayer from "./utils/bboxLayer.js";
import isBoundingBox from "./utils/is-bounding-box.js";
import toAbsolute from "./utils/to-absolute.js";
import isRelative from "./utils/is-relative.js";
import tiTilerLayer from "./utils/titiler-layer.js";
import { DATA_TYPES, EVENT_DATA_TYPES, MIME_TYPES } from "./data.js";

// utility functions
// get asset extension, if type and if missing type or maybe throw an error
// that item is missing a type

const isJPG = type => !!type.match(/^image\/jpe?g/i);
const isPNG = type => !!type.match(/^image\/png/i);
const isImage = type => isJPG(type) || isPNG(type);
const isAssetCOG = asset => MIME_TYPES.COG.includes(asset.type);

const bandName = asset => asset?.["eo:bands"]?.[0]?.name;

const findBand = (assets, bandName) => {
  for (let key in assets) {
    const asset = assets[key];
    if (asset?.["eo:bands"]?.[0]?.common_name === bandName) {
      return { key, asset };
    }
  }
};

const findVisualAsset = assets => {
  for (let key in assets) {
    const asset = assets[key];
    if (key.toLowerCase() === "visual") {
      return { key, asset };
    } else if (Array.isArray(asset.roles) && asset.roles.some(role => role.toLowerCase() === "visual")) {
      return { key, asset };
    }
  }
};
const hasVisualAsset = assets => !!findVisualAsset(assets);

const hasSeparatedRGB = assets => findBand(assets, "red") && findBand(assets, "green") && findBand(assets, "blue");

const findLinks = data => {
  if (Array.isArray(data)) return data;
  else if (data.links) return data.links;
};

const findLink = (data, key) => {
  const links = findLinks(data);
  key = key.toLowerCase();
  if (links) return links.find(ln => typeof ln === "object" && ln.rel.toLowerCase() === key);
};

const findSelf = data => findLink(data, "self");
const findSelfHref = data => findSelf(data)?.href;

const getBoundingBox = item => {
  if (isBoundingBox(item.bbox)) {
    return item.bbox;
  } else if (item?.extent?.spatial?.bbox) {
    const bbox = item?.extent?.spatial?.bbox;
    const depth = getDepth(bbox);
    if (Array.isArray(bbox) && bbox.length === 4 && depth === 1) {
      return bbox;
    } else if (depth === 2) {
      return bbox[0];
    }
  }
};

const getLatLngBounds = item => {
  const bbox = getBoundingBox(item);
  if (bbox) return bboxToLatLngBounds(bbox);
  if (item.geometry) return L.geoJSON(item.geometry).getBounds();
};

function getDataType(data) {
  // no longer used
  // if (Array.isArray(data.links)) {
  //   const href = findSelfHref(data);
  //   // don't use new URL(href).pathname because
  //   // sometimes href is relative and construction fails
  //   if (typeof href === "string") {
  //     if (href.match(/collections\/[^/]+\/items$/)) {
  //       return DATA_TYPES.STAC_API_ITEMS;
  //     }
  //   }
  // }

  const hasLinks = Array.isArray(data.links);

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

  if (Array.isArray(data.assets)) {
    return DATA_TYPES.STAC_ITEM;
  }

  if (hasLinks && ("bbox" in data || "extent" in data)) {
    return DATA_TYPES.STAC_COLLECTION;
  }

  if (hasLinks) {
    return DATA_TYPES.STAC_CATALOG;
  }

  if ("href" in data && "title" in data) {
    return DATA_TYPES.STAC_ASSET;
  }

  if (Array.isArray(data) && data.every(it => "href" in it && "title" in it)) {
    return DATA_TYPES.STAC_ASSETS;
  }

  throw new Error("[stac-layer] couldn't determine type of the input data");
}

// relevant links:
// https://github.com/radiantearth/stac-browser/blob/v3/src/stac.js
const stacLayer = async (data, options = {}) => {
  const debugLevel = options.debugLevel || 0;

  if (debugLevel >= 1) console.log("[stac-layer] starting");
  if (debugLevel >= 2) console.log("[stac-layer] data:", data);
  if (debugLevel >= 2) console.log("[stac-layer] options:", options);

  // preprocessing
  // remove trailing slash from titiler url
  if (options.titiler) options.titiler.replace(/\/$/, "");

  const displayPreview = [true, false].includes(options.displayPreview) ? options.displayPreview : true;

  const useTileLayer = options.tileUrlTemplate || options.buildTileUrlTemplate;
  const preferTileLayer = useTileLayer && !options.useTileLayerAsFallback;
  if (debugLevel >= 2) console.log("[stac-layer] preferTileLayer:", preferTileLayer);

  // get link to self, which we might need later
  const selfHref = findSelfHref(data);
  if (debugLevel >= 2) console.log("[stac-layer] self href:", selfHref);

  const baseUrl = options.baseUrl || selfHref?.substring(0, selfHref.lastIndexOf("/") + 1);
  // add a / to the end of the base url to make sure toAbsolute works later on
  if (baseUrl && !baseUrl.endsWith("/")) baseUrl += "/";
  if (debugLevel >= 2) console.log("[stac-layer] base url:", baseUrl);

  const toAbsoluteHref = href => {
    if (!href) throw new Error("[stac-layer] can't convert nothing to an absolute href");
    if (!isRelative(href)) return href;
    if (!baseUrl) throw new Error(`[stact-layer] can't determine an absolute url for "${href}" without a baseUrl`);
    return toAbsolute(href, baseUrl);
  };

  const layerGroup = L.layerGroup();

  // if the given layer fails for any reason, remove it from the map, and call the fallback
  const setFallback = (lyr, fallback) => {
    let count = 0;
    ["tileerror"].forEach(name => {
      lyr.on(name, evt => {
        count++;
        // sometimes LeafletJS might issue multiple error events before
        // the layer is removed from the map
        // the following makes sure we only active the fallback sequence once
        if (count === 1) {
          console.log(`[stac-layer] activating fallback because "${evt.error.message}"`);
          if (layerGroup.hasLayer(lyr)) layerGroup.removeLayer(lyr);
          fallback();
        }
      });
    });
  };

  // hijack on event to support on("click") as it isn't normally supported by layer groups
  const onClickHandlers = [];
  layerGroup.on = (name, callback) => {
    if (name === "click") {
      onClickHandlers.push(callback);
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
  } else if (dataType === DATA_TYPES.STAC_COLLECTION) {
    // STAC Collection
    const preview = findLink(data, "preview");
    if (debugLevel >= 1) console.log("[stac-layer] preview is ", preview);

    if (displayPreview && preview && isImage(preview?.type)) {
      const href = toAbsoluteHref(preview.href);
      if (debugLevel >= 1) console.log("[stac-layer] href is " + href);
      const bbox = getBoundingBox(data);
      if (debugLevel >= 1) console.log("[stac-layer] bbox is " + bbox);
      const latLngBounds = bboxToLatLngBounds(bbox);
      const lyr = L.imageOverlay(href, latLngBounds);
      bindDataToClickEvent(lyr);
      layerGroup.addLayer(lyr);
    }

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
  } else if (dataType === DATA_TYPES.STAC_ITEM) {
    const { assets } = data;

    const assetEntries = Object.entries(assets);

    const assetKeys = Object.keys(assets);

    const assetValues = Object.values(assets);

    const assetCount = assetKeys.length;

    const cogs = assetValues.filter(isAssetCOG);

    const bounds = getLatLngBounds(data);
    if (debugLevel >= 1) console.log(`[stac-layer] item bounds are: ${bounds.toBBoxString()}`);

    if (assetCount === 1 && isAssetCOG(assets[assetKeys[0]])) {
      try {
        if (debugLevel >= 1) console.log(`[stac-layer] there is only one asset and it is a Cloud-Optimized GeoTIFF`);
        const key = assetKeys[0];
        const asset = assets[key];
        const href = toAbsoluteHref(asset?.href);
        if (debugLevel >= 2) console.log("[stac-layer] asset's href is:", href);
        const addTileLayer = () => {
          if (options.buildTileUrlTemplate) {
            const tileUrlTemplate = options.buildTileUrlTemplate({
              href,
              url: href,
              asset,
              key,
              item: asset,
              bounds,
              isCOG: true,
              isVisual: null
            });
            if (debugLevel >= 2) console.log(`[stac-layer] built tile url template: "${tileUrlTemplate}"`);
            const tileLayerOptions = { bounds, ...options, url: href };
            const tileLayer = L.tileLayer(tileUrlTemplate, tileLayerOptions);
            layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
            bindDataToClickEvent(tileLayer, asset);
            layerGroup.addLayer(tileLayer);
          } else if (options.tileUrlTemplate) {
            const tileLayerOptions = { bounds, ...options, url: href };
            const tileLayer = L.tileLayer(options.tileUrlTemplate, tileLayerOptions);
            bindDataToClickEvent(tileLayer, asset);
            layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
            layerGroup.addLayer(tileLayer);
            if (debugLevel >= 2) console.log("[stac-layer] added tile layer to layer group");
          }
        };
        if (preferTileLayer) {
          addTileLayer();
        } else {
          try {
            const georaster = await parseGeoRaster(href);
            const georasterLayer = new GeoRasterLayer({
              georaster,
              ...options
            });
            bindDataToClickEvent(georasterLayer, asset);
            layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
            setFallback(georasterLayer, addTileLayer);
            layerGroup.addLayer(georasterLayer);
          } catch (error) {
            if (useTileLayer) {
              if (debugLevel >= 2)
                console.log(
                  `[stac-layer] failed to create an instance of GeoRasterLayer, so falling back to using Leaflet's TileLayer:`,
                  error
                );
              addTileLayer();
            } else {
              if (debugLevel >= 2)
                console.log("[stac-layer] failed to create an instance of GeoRasterLayer because of", error);
            }
          }
        }
      } catch (error) {
        console.log("[stac-layer] can't visualize COG because of the following error: " + error.message);
      }
    } else if (hasVisualAsset(assets) && isAssetCOG(assets.visual)) {
      if (debugLevel >= 1) console.log(`[stac-layer] found visual asset, so displaying that`);
      // default to using the visual asset
      const { asset, key } = findVisualAsset(assets);
      const href = toAbsoluteHref(asset.href);
      const addTileLayer = () => {
        if (options.buildTileUrlTemplate) {
          const tileUrlTemplate = options.buildTileUrlTemplate({
            href,
            url: href,
            asset,
            key,
            item: data,
            bounds,
            isCOG: true,
            isVisual: true
          });
          if (debugLevel >= 2) console.log(`[stac-layer] built tile url template: "${tileUrlTemplate}"`);
          const tileLayerOptions = { bounds, ...options, url: href };
          const tileLayer = L.tileLayer(tileUrlTemplate, tileLayerOptions);
          layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
          bindDataToClickEvent(tileLayer, asset);
          layerGroup.addLayer(tileLayer);
        } else if (options.tileUrlTemplate) {
          if (debugLevel >= 2) console.log(`[stac-layer] using tile url template: "${options.tileUrlTemplate}"`);
          const tileLayerOptions = { bounds, ...options, url: href };
          const tileLayer = L.tileLayer(options.tileUrlTemplate, tileLayerOptions);
          layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
          bindDataToClickEvent(tileLayer, asset);
          layerGroup.addLayer(tileLayer);
        }
      };

      if (preferTileLayer) {
        addTileLayer();
      } else {
        try {
          if (debugLevel >= 2) console.log(`[stac-layer] will try to visualize with georaster-layer-for-leaflet`);
          const georaster = await parseGeoRaster(href);
          const georasterLayer = new GeoRasterLayer({
            georaster,
            ...options,
            debugLevel: (options.debugLevel || 1) - 1
          });
          layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
          setFallback(georasterLayer, addTileLayer);
          bindDataToClickEvent(georasterLayer, asset);
          setFallback(georasterLayer, addTileLayer);
          layerGroup.addLayer(georasterLayer);
        } catch (error) {
          if (useTileLayer) {
            if (debugLevel >= 2)
              console.log(
                `[stac-layer] failed to create an instance of GeoRasterLayer, so falling back to using Leaflet's TileLayer:`,
                error
              );
            addTileLayer();
          } else {
            if (debugLevel >= 2)
              console.log("[stac-layer] failed to create an instance of GeoRasterLayer because of", error);
          }
        }
      }
    } else if (hasSeparatedRGB(assets)) {
      if (debugLevel >= 1) console.log(`[stac-layer] Red, Green, and Blue bands are separated into different files`);
      const { key: redKey, asset: redAsset } = findBand(assets, "red");
      const { key: greenKey, asset: greenAsset } = findBand(assets, "green");
      const { key: blueKey, asset: blueAsset } = findBand(assets, "blue");
      const rgbAssets = [redAsset, greenAsset, blueAsset];
      const assetNames = rgbAssets.map(bandName);

      // success means we have successfully added an image visualization (vs. vector)
      let success = false;

      const addTileLayer = async () => {
        if (options.titiler) {
          const tileLayer = await tiTilerLayer({
            assets: assetNames,
            debugLevel,
            titiler: options.titiler,
            quiet: true,
            url: selfHref
          });
          if (tileLayer) {
            const bands = [redAsset?.["eo:bands"], greenAsset?.["eo:bands"], blueAsset?.["eo:bands"]]
              .flat()
              .filter(Boolean);
            layerGroup.stac = {
              assets: [
                { key: redKey, asset: redAsset },
                { key: greenKey, asset: greenAsset },
                { key: blueKey, asset: blueAsset }
              ],
              bands: bands.length > 0 ? bands : undefined
            };
            bindDataToClickEvent(tileLayer, rgbAssets);
            layerGroup.addLayer(tileLayer);
            return true;
          }
        }
        return false;
      };

      if (debugLevel >= 2) console.log(`[stac-layer]`, { redAsset, greenAsset, blueAsset });
      if (rgbAssets.some(asset => asset.href.startsWith("s3://"))) {
        // GeoRasterLayer can't visualize S3, so just skip to trying titiler
        if (debugLevel >= 1) console.log("[stac-layer] at least one of the band files uses the s3 protocol");
        if (options.titiler) {
          success = await addTileLayer();
        } else {
          if (debugLevel >= 1) console.log("[stac-layer] we cannot visualize the separate RGB files without titiler");
        }
      } else {
        if (preferTileLayer && options.titiler) {
          // addTileLayer will return false if unsuccessful
          success = await addTileLayer();
        }

        if (!success) {
          try {
            // we start fetching the green's data
            // before the red's data has resolved
            const georasters = await Promise.resolve([
              parseGeoRaster(toAbsoluteHref(redAsset.href)),
              parseGeoRaster(toAbsoluteHref(greenAsset.href)),
              parseGeoRaster(toAbsoluteHref(blueAsset.href))
            ]);
            const georasterLayer = new GeoRasterLayer({
              georasters,
              ...options
            });
            const bands = [redAsset?.["eo:bands"], greenAsset?.["eo:bands"], blueAsset?.["eo:bands"]]
              .flat()
              .filter(Boolean);
            layerGroup.stac = {
              assets: [
                { key: redKey, asset: redAsset },
                { key: greenKey, asset: greenAsset },
                { key: blueKey, asset: blueAsset }
              ],
              bands: bands.length > 0 ? bands : undefined
            };
            bindDataToClickEvent(georasterLayer, assets);
            setFallback(georasterLayer, addTileLayer);
            layerGroup.addLayer(georasterLayer);
            success = true;
          } catch (error) {
            console.log(
              "[stac-layer] caught the following error trying to visualize separate RGB bands using GeoRasterLayer",
              error
            );
          }
        }

        if (!success && options.titiler) {
          await addTileLayer();
        }
      }

      if (!success) {
        try {
          const { thumbnail } = assets;
          if (debugLevel >= 2) console.log("[stac-layer] thumbnail is ", thumbnail);
          if (displayPreview && thumbnail && isImage(thumbnail?.type)) {
            const href = toAbsoluteHref(thumbnail.href);
            if (href.startsWith("s3://"))
              console.log("[stac-layer] we have no way of visualizing thumbnails via S3 protocol");
            const lyr = L.imageOverlay(href, bounds);
            layerGroup.stac = { assets: [{ key: "thumbnail", asset: thumbnail }], bands: thumbnail?.["eo:bands"] };
            // assume don't want to return only thumbnail information from click event,
            // because it wouldn't be that useful
            bindDataToClickEvent(lyr);
            layerGroup.addLayer(lyr);
          }
        } catch (error) {
          console.error("[stac-layer] caught the following error while trying to visualize the thumbnail asset", error);
        }
      }
    } else if (cogs.length >= 1) {
      if (debugLevel >= 1) console.log(`[stac-layer] defaulting to trying to display the first COG asset"`);
      try {
        const asset = cogs[0];
        const key = assetEntries.find(([key, value]) => value === asset)[0];
        const href = toAbsoluteHref(asset?.href);

        const addTileLayer = () => {
          if (options.buildTileUrlTemplate) {
            const tileUrlTemplate = options.buildTileUrlTemplate({
              href,
              url: href,
              asset,
              key,
              item: data,
              bounds,
              isCOG: true,
              isVisual: false
            });
            const tileLayerOptions = { bounds, ...options, url: href };
            const tileLayer = L.tileLayer(tileUrlTemplate, tileLayerOptions);
            layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
            bindDataToClickEvent(tileLayer, asset);
            layerGroup.addLayer(tileLayer);
          } else if (options.tileUrlTemplate) {
            const tileLayerOptions = { bounds, ...options, url: href };
            const tileLayer = L.tileLayer(options.tileUrlTemplate, tileLayerOptions);
            layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
            bindDataToClickEvent(tileLayer, asset);
            layerGroup.addLayer(tileLayer);
          }
        };

        if (preferTileLayer) {
          addTileLayer();
        } else {
          try {
            const georaster = await parseGeoRaster(href);
            const georasterLayer = new GeoRasterLayer({
              georaster,
              ...options
            });
            if (debugLevel >= 1) console.log("[stac-layer] successfully created layer for", asset);
            bindDataToClickEvent(georasterLayer, asset);
            layerGroup.stac = { assets: [{ key, asset }], bands: asset?.["eo:bands"] };
            setFallback(georasterLayer, addTileLayer);
            layerGroup.addLayer(georasterLayer);
          } catch (error) {
            if (useTileLayer) {
              addTileLayer();
            }
          }
        }
      } catch (error) {
        console.error("caught error so checking geometry:", error);
      }
    }

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

    // default to filling in the bounds layer unless we successfully visualize an image
    let fillOpacity = 0.2;

    if (debugLevel >= 1) console.log("[stac-layer] visualizing " + type);
    if (MIME_TYPES.JPG.includes(type) || MIME_TYPES.PNG.includes(type)) {
      if (!bounds) {
        throw new Error(
          `[stac-layer] cannot visualize asset of type "${type}" without a location.  Please pass in an options object with bounds or bbox set.`
        );
      }

      const lyr = L.imageOverlay(href, bounds);
      bindDataToClickEvent(lyr);
      layerGroup.addLayer(lyr);
      fillOpacity = 0;
    } else if (MIME_TYPES.GEOTIFF.includes(type)) {
      const addTileLayer = () => {
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
          const tileLayer = L.tileLayer(tileUrlTemplate, tileLayerOptions);
          layerGroup.stac = { assets: [{ key: null, asset: data }], bands: data?.["eo:bands"] };
          bindDataToClickEvent(tileLayer);
          layerGroup.addLayer(tileLayer);
          fillOpacity = 0;
        } else if (options.tileUrlTemplate) {
          const tileLayerOptions = { bounds, ...options, url: href };
          const tileLayer = L.tileLayer(options.tileUrlTemplate, tileLayerOptions);
          layerGroup.stac = { assets: [{ key: null, asset: data }], bands: data?.["eo:bands"] };
          bindDataToClickEvent(tileLayer);
          layerGroup.addLayer(tileLayer);
          fillOpacity = 0;
        }
      };

      if (preferTileLayer) {
        addTileLayer();
      } else {
        try {
          const georaster = await parseGeoRaster(href);
          try {
            const georasterLayer = new GeoRasterLayer({
              georaster,
              ...options
            });
            layerGroup.stac = { assets: [{ key: null, asset: data }], bands: data?.["eo:bands"] };
            bindDataToClickEvent(georasterLayer);
            setFallback(georasterLayer, addTileLayer);
            layerGroup.addLayer(georasterLayer);
          } catch (error) {
            if (useTileLayer) addTileLayer();
          }
          const bbox = [georaster.xmin, georaster.ymin, georaster.xmax, georaster.ymax];
          const reprojectedBoundingBox = reprojectBoundingBox({
            bbox,
            from: georaster.projection,
            to: 4326
          });
          bounds = bboxToLatLngBounds(reprojectedBoundingBox);
          fillOpacity = 0;
        } catch (error) {
          console.error("caught error so checking geometry:", error);
        }
      }
    }

    if (bounds) {
      if (debugLevel >= 1) console.log("[stac-layer] adding bounds layer");
      const lyr = L.rectangle(bounds, { fillOpacity });
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

  if (!layerGroup.options) layerGroup.options = {};

  layerGroup.options.debugLevel = debugLevel;

  return layerGroup;
};

L.stacLayer = stacLayer;

export default stacLayer;
