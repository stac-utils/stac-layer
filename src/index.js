import L from "leaflet";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

import { default as createStacObject, STAC, Asset, Catalog } from "stac-js";
import { toAbsolute } from "stac-js/src/http.js";
import { bindDataToClickEvent, enableLogging, log, registerEvents } from "./events.js";
import { addAsset, addDefaultGeoTiff, addFootprintLayer, addThumbnails } from "./add.js";
import { isBoundingBox } from "stac-js/src/geo.js";

// Data must be: Catalog, Collection, Item, API Items, or API Collections
const stacLayer = async (data, options = {}) => {
  if (!data) {
    throw new Error("No data provided");
  }

  options = Object.assign(
    {
      // defaults:
      displayGeoTiffByDefault: false,
      displayPreview: false,
      displayOverview: true,
      debugLevel: 0,
      resolution: 32,
      useTileLayerAsFallback: false,
      itemStyle: {},
      boundsStyle: {}
    },
    options
  ); // shallow clone options

  enableLogging(options.debugLevel);

  log(1, "starting");

  // Deprecated:
  // Allow just passing assets in data as before
  if ("href" in data) {
    options.assets = [data];
    data = {}; // This will result in an empty Catalog
  } else if (Array.isArray(data) && data.every(asset => "href" in asset)) {
    options.assets = data;
    data = {}; // This will result in an empty Catalog
  }

  // Convert to stac-js and set baseUrl
  if (!(data instanceof STAC)) {
    data = createStacObject(data);
    if (options.baseUrl) {
      data.setAbsoluteUrl(options.baseUrl);
    }
  }
  log(2, "data:", data);
  log(2, "url:", data.getAbsoluteUrl());

  if (data instanceof Catalog) {
    log(1, "Catalogs don't have spatial information, you may see an empty map");
  }

  // Tile layer preferences
  options.useTileLayer = options.tileUrlTemplate || options.buildTileUrlTemplate;
  options.preferTileLayer = (options.useTileLayer && !options.useTileLayerAsFallback) || false;
  log(2, "preferTileLayer:", options.preferTileLayer);

  if (options.bbox && !isBoundingBox(options.bbox)) {
    log(1, "The provided bbox is invalid");
  }

  // Handle assets
  if (typeof options.assets === "string") {
    options.assets = [options.assets];
  }
  options.assets = (options.assets || [])
    .map(asset => {
      const original = asset;
      if (typeof asset === "string") {
        asset = data.getAsset(asset);
        if (!(asset instanceof Asset)) {
          log(1, "can't find asset with the given key:", original);
        }
        return asset;
      }
      if (!(asset instanceof Asset)) {
        return new Asset(asset, toAbsolute(asset.href, data.getAbsoluteUrl()), data);
      }
      log(1, "invalid asset provided:", original);
      return null;
    })
    .filter(asset => asset instanceof Asset);

  // Compose a view for multi-bands
  if (Array.isArray(options.bands) && options.bands.length >= 1 && options.bands.length <= 4) {
    if (options.bands.length === 1) {
      let [g] = options.bands;
      options.bands = [g, g, g];
    } else if (options.bands.length === 2) {
      let [g, a] = options.bands;
      options.bands = [g, g, g, a];
    }

    options.calcStats = true;
    options.pixelValuesToColorFn = values => {
      const { mins, maxs, ranges } = options.currentStats;
      const fitted = values.map((v, i) => {
        if (options.alphas[i]) {
          const { int, min, range } = options.alphas[i];
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

  log(2, "options:", options);

  // Create the layer group that we add all layers to
  const layerGroup = L.layerGroup();
  registerEvents(layerGroup);

  let promises = [];

  if (data.isItemCollection()) {
    const style = Object.assign({}, options.itemStyle, { fillOpacity: 0, weight: 1, color: "#ff8833" });
    const lyr = createGeoJsonLayer(data.toGeoJSON(), style);
    promises = data.features.map(item => {
      return addThumbnails(item, layerGroup, options).then(layer => {
        if (!layer) {
          return addDefaultGeoTiff(item, layerGroup, options);
        }
      });
    });
    // todo: This needs work to be more consistent
    bindDataToClickEvent(lyr, e => {
      try {
        const point = [e.latlng.lng, e.latlng.lat];
        const matches = data.features.filter(item => booleanPointInPolygon(point, item));
        if (matches.length >= 2) {
          return matches;
        }
      } catch (error) {
        // code above failed, so just skip intersection checks
        // and return feature given by LeafletJS event
      }
      return e?.layer?.feature;
    });
    layerGroup.addLayer(lyr);
  } else if (data.isItem() || data.isCollection() || options.assets.length > 0) {
    // No specific asset given by the user, visualize the default geotiff
    if (options.assets.length > 0) {
      log(2, "number of assets in options:", options.assets.length);
      promises = options.assets.map(asset => addAsset(asset, layerGroup, options));
    } else {
      promises.push(
        addDefaultGeoTiff(data, layerGroup, options).then(layer => {
          if (!layer) {
            return addThumbnails(data, layerGroup, options);
          }
        })
      );
    }
  }

  addFootprintLayer(data, layerGroup, options);

  // use the extent of the vector layer
  layerGroup.getBounds = () => {
    const lyr = layerGroup.getLayers().find(lyr => lyr.toGeoJSON);
    if (!lyr) {
      log(
        1,
        "unable to get bounds without a vector layer. This often happens when there was an issue determining the bounding box of the provided data."
      );
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

  layerGroup.options.debugLevel = options.debugLevel;

  if (options.map) {
    options.map.addLayer(layerGroup);
    options.map.fitBounds(layerGroup.getBounds());
  }

  await Promise.all(promises);

  return layerGroup;
};

L.stacLayer = stacLayer;

export default stacLayer;
