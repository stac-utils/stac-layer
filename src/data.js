export const DATA_TYPES = {
  STAC_ITEM: "STAC Item",
  STAC_CATALOG: "STAC Catalog",
  STAC_COLLECTION: "STAC Collection",
  ITEM_COLLECTION: "Item Collection",
  STAC_API_COLLECTIONS: "STAC API Collections",
  STAC_API_ITEMS: "STAC API Items",
  STAC_ASSETS: "STAC Assets",
  STAC_ASSET: "STAC Asset"
};

export const EVENT_DATA_TYPES = {
  COLLECTION: "Collection",
  FEATURE: "Feature",
  ASSETS: "Assets",
  ASSET: "Asset"
};

export const MIME_TYPES = {
  COG: ["image/tiff; application=geotiff; profile=cloud-optimized", "image/vnd.stac.geotiff; cloud-optimized=true"],
  GEOTIFF: [
    "application/geotiff",
    "image/tiff; application=geotiff",
    "image/tiff; application=geotiff; profile=cloud-optimized",
    "image/vnd.stac.geotiff",
    "image/vnd.stac.geotiff; cloud-optimized=true"
  ],
  BROWSER: ["image/jpeg", "image/jpg", "image/png", "image/apng", "image/gif", "image/webp"]
};

export const GEORASTER_KEYS = [
  "maxs",
  "mins",
  "ranges",
  "noDataValue",
  "pixelHeight",
  "pixelWidth",
  "projection",
  "values",
  "width",
  "xmax",
  "xmin",
  "ymax",
  "ymin",
  "palette"
];
