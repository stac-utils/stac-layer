import L from "leaflet";
import parseGeoRaster from "georaster";
import GeoRasterLayer from "georaster-layer-for-leaflet";
import parseFileName from "parse-filename";
import getDepth from "get-depth";

import bboxToLatLngBounds from "./utils/bboxToLatLngBounds.js";
import bboxLayer from "./utils/bboxLayer.js";
import isBoundingBox from "./utils/is-bounding-box.js";
import reprojectBoundingBox from "reproject-bbox";
import { DATA_TYPES, GEORASTER_KEYS, MIME_TYPES } from "./data.js";
import pick from "./utils/pick.js";

// utility functions
// get asset extension, if type and if missing type or maybe throw an error
// that item is missing a type

const filterRels = rels =>
  !["self", "parent", "root", "related", "license", "successor-version", "cite-as"].includes(rel);

const ITEM_TYPES = {
  COG: [
    "image/vnd.stac.geotiff; cloud-optimized=true",
    "image/tiff; application=geotiff; profile=cloud-optimized"
  ],
  PREVIEW: ["image/jpg", "image/png"],
  THUMBNAIL: ["image/jpg", "image/png"]
};

const isJPG = type => !!type.match(/^image\/jpe?g/i);
const isPNG = type => !!type.match(/^image\/png/i);
const isImage = type => isJPG(type) || isPNG(type);

const isAssetCOG = asset => ITEM_TYPES.COG.includes(asset.type);

const findBand = (assets, bandName) => {
  for (let assetKey in assets) {
    const asset = assets[assetKey];
    if (asset?.["eo:bands"]?.[0]?.common_name === bandName) {
      return asset;
    }
  }
};

const findVisualAsset = assets => {
  for (let assetKey in assets) {
    const asset = assets[assetKey];
    if (assetKey === "visual") {
      return asset;
    } else if (Array.isArray(asset.roles) && asset.roles.includes("visual")) {
      return asset;
    }
  }
};

const hasRGB = assets =>
  findBand(assets, "red") && findBand(assets, "green") && findBand(assets, "blue");

const getLinkByRel = (links, key) =>
  links.find(ln => typeof ln === "object" && ln.rel.toLowerCase() === key.toLowerCase());

const getBoundingBox = item => {
  if (Array.isArray(item.bbox)) {
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
function getDataType(data) {
  if (Array.isArray(data.links)) {
    const href = getLinkByRel(data.links, "self")?.href;
    if (typeof href === "string") {
      const { pathname } = new URL(href);
      if (pathname.match(/collections\/[^/]+\/items$/)) {
        return DATA_TYPES.STAC_API_ITEMS;
      }
    }
  }

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

  throw new Error("[stac-layer] couldn't determine type of the input data");
}

// relevant links:
// https://github.com/radiantearth/stac-browser/blob/v3/src/stac.js
const stacLayer = async (data, options = {}) => {
  const debugLevel = options.debugLevel || 0;

  const displayPreview = [true, false].includes(options.displayPreview)
    ? options.displayPreview
    : true;

  if (debugLevel >= 1) console.log("[stac-layer] starting");

  const layerGroup = L.layerGroup();

  const dataType = getDataType(data);
  if (debugLevel >= 1) console.log(`[stac-layer] data is of type "${dataType}"`);

  if (dataType === DATA_TYPES.ITEM_COLLECTION) {
    // Item Collection aka GeoJSON Feature Collection where each Feature is a STAC Item
    const layer = L.geoJSON(data, options);
    layerGroup.addLayer(layer);
  } else if (dataType === DATA_TYPES.STAC_API_ITEMS) {
    const layer = L.geoJSON(data, options);
    layerGroup.addLayer(layer);
  } else if (dataType === DATA_TYPES.STAC_COLLECTION) {
    // STAC Collection
    const { links } = data;
    const preview = links.find(ln => ln.rel.toLowerCase() === "preview");
    if (debugLevel >= 1) console.log("[stac-layer] preview is ", preview);
    if (displayPreview && preview && isImage(preview?.type)) {
      const { href, rel, type } = preview;
      if (debugLevel >= 1) console.log("[stac-layer] href is " + href);
      const bbox = getBoundingBox(data);
      if (debugLevel >= 1) console.log("[stac-layer] bbox is " + bbox);
      const latLngBounds = bboxToLatLngBounds(bbox);
      const layer = L.imageOverlay(href, latLngBounds);
      layerGroup.addLayer(layer);
    } else {
      const bboxes = data?.extent?.spatial?.bbox;
      if (!bboxes)
        throw "[stac-layer] could not determine bounding box for collection. did you define extent spatial bbox?";
      if (Array.isArray(bboxes) && bboxes.length === 1) {
        layerGroup.addLayer(bboxLayer(bboxes[0], options));
      } else if (Array.isArray(bboxes) && bboxes.length >= 2) {
        const layers = bboxes.slice(1).map(bbox => bboxLayer(bbox, options));
        const featureGroup = L.featureGroup(layers);
        layerGroup.addLayer(featureGroup);
      }
    }
  } else if (dataType === DATA_TYPES.STAC_ITEM) {
    const { assets } = data;

    const assetKeys = Object.keys(assets);

    const assetValues = Object.values(assets);

    const assetCount = assetKeys.length;

    const cogs = assetValues.filter(isAssetCOG);

    if (assetCount === 1 && isAssetCOG(assets[assetKeys[0]])) {
      // there is only one asset and it is a Cloud-Optimized GeoTIFF
      const asset = assets[assetKeys[0]];
      try {
        const { href } = asset;
        const georaster = await parseGeoRaster(href);
        const georasterLayer = new GeoRasterLayer({
          georaster,
          ...options
        });
        layerGroup.addLayer(georasterLayer);
      } catch (error) {
        console.error("caught error so checking geometry:", error);
      }
    } else if (findVisualAsset(assets) && isAssetCOG(assets.visual)) {
      // default to using the visual asset
      const asset = findVisualAsset(assets);
      try {
        const { href } = asset;
        const georaster = await parseGeoRaster(href);
        const georasterLayer = new GeoRasterLayer({
          georaster,
          ...options
        });
        layerGroup.addLayer(georasterLayer);
      } catch (error) {
        console.error("caught error so checking geometry:", error);
      }
    } else if (hasRGB(assets)) {
      const red = findBand(assets, "red");
      const green = findBand(assets, "green");
      const blue = findBand(assets, "blue");
      try {
        const georasters = [
          await parseGeoRaster(red.href),
          await parseGeoRaster(green.href),
          await parseGeoRaster(blue.href)
        ];
        const georasterLayer = new GeoRasterLayer({
          georasters,
          ...options
        });
        layerGroup.addLayer(georasterLayer);
      } catch (error) {
        console.error("caught error trying separate R G B bands, so trying thumbnail");
        try {
          const { thumbnail } = assets;
          if (debugLevel >= 1) console.log("[stac-layer] thumbnail is ", thumbnail);
          if (displayPreview && thumbnail && isImage(thumbnail?.type)) {
            const { href, rel, type } = thumbnail;
            if (href.startsWith("s3://")) console.log("[stac-layer] no support for s3:// urls");
            const bbox = getBoundingBox(data);
            const latLngBounds = bboxToLatLngBounds(bbox);
            const layer = L.imageOverlay(href, latLngBounds);
            layerGroup.addLayer(layer);
          }
        } catch (error2) {
          console.error("error 2:", error2);
        }
      }
    } else if (cogs.length >= 1) {
      if (debugLevel >= 1)
        console.log(`[stac-layer] defaulting to trying to display the first COG asset"`);
      try {
        const asset = cogs[0];
        const { href } = asset;
        const georaster = await parseGeoRaster(href);
        const georasterLayer = new GeoRasterLayer({
          georaster,
          ...options
        });
        if (debugLevel >= 1) console.log("[stac-layer] successfully created layer for", asset);
        layerGroup.addLayer(georasterLayer);
      } catch (error) {
        console.error("caught error so checking geometry:", error);
      }
    }

    if ("geometry" in data && typeof data.geometry === "object") {
      layerGroup.addLayer(
        L.geoJSON(data.geometry, {
          fillOpacity: layerGroup.getLayers().length > 0 ? 0 : undefined,
          ...options
        })
      );
    } else if ("bbox" in data && Array.isArray(data.bbox) && data.bbox.length === 4) {
      layerGroup.addLayer(
        L.bboxLayer(data, {
          fillOpacity: layerGroup.getLayers().length > 0 ? 0 : undefined,
          ...options
        })
      );
    }
  } else if (dataType === DATA_TYPES.STAC_ASSET) {
    const { href, roles, type } = data;
    if (MIME_TYPES.JPG.includes(type) || MIME_TYPES.PNG.includes(type)) {
      let latLngBounds;
      if (options.latLngBounds) {
        latLngBounds = options.latLngBounds;
      } else if (options.bounds) {
        latLngBounds = options.bounds;
      } else if (options.bbox) {
        if (!isBoundingBox(options.bbox))
          throw new Error("bbox property in options does not appear to be formatted correctly.");
        latLngBounds = bboxToLatLngBounds(options.bbox);
      }

      if (!latLngBounds) {
        throw new Error(
          `[stac-layer] cannot visualize asset of type "${type}" without a location.  Please pass in an options object with bbox set.`
        );
      }

      const lyr = L.imageOverlay(href, latLngBounds);
      layerGroup.addLayer(lyr);
    } else if (MIME_TYPES.GEOTIFF.includes(type)) {
      try {
        const { href } = data;
        const georaster = await parseGeoRaster(href);
        const georasterLayer = new GeoRasterLayer({
          georaster,
          ...options
        });
        layerGroup.addLayer(georasterLayer);
        const bbox = [georaster.xmin, georaster.ymin, georaster.xmax, georaster.ymax];
        const reprojectedBoundingBox = reprojectBoundingBox({
          bbox,
          from: georaster.projection,
          to: 4326
        });
        const lyr = bboxLayer(reprojectedBoundingBox, {
          fillOpacity: 0
        });
        layerGroup.addLayer(lyr);
      } catch (error) {
        console.error("caught error so checking geometry:", error);
      }
    }
  } else {
    throw new Error(
      `[stac-layer] does not support visualization of data of the type "${dataType}"`
    );
  }

  // use the extent of the vector layer
  layerGroup.getBounds = () => {
    const bounds = layerGroup.getLayers().find(lyr => lyr.toGeoJSON).getBounds();
    const southWest = [bounds.getSouth(), bounds.getWest()];
    const northEast = [bounds.getNorth(), bounds.getEast()];
    return [southWest, northEast];
  };

  return layerGroup;
};

L.stacLayer = stacLayer;

export default stacLayer;
