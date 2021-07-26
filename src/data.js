export const DATA_TYPES = {
  STAC_ITEM: "STAC Item",
  STAC_CATALOG: "STAC Catalog",
  STAC_COLLECTION: "STAC Collection",
  ITEM_COLLECTION: "ITEM Collection",
  STAC_API_COLLECTIONS: "STAC API Collections",
  STAC_API_ITEMS: "STAC API Items",
  STAC_ASSET: "STAC Asset"
};

export const MIME_TYPES = {
  GEOTIFF: [
    "application/geotiff",
    "image/tiff; application=geotiff;",
    "image/tiff; application=geotiff; profile=cloud-optimized",
    "image/vnd.stac.geotiff; cloud-optimized=true"
  ],
  JPG: ["image/jpeg", "image/jpg"],
  PNG: ["image/png"]
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
