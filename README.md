# stac-layer
> Visualize [STAC](https://stacspec.org/) data on a [LeafletJS](https://leafletjs.com/) map

<img src="./stac-layer.gif" height=200>

# Install
```bash
npm install stac-layer
```

# Supported STAC types
- STAC Collection (+ Assets)
- STAC Item (+ Assets)
- STAC API Collections
- STAC API Items (ItemCollection)

# Usage

```js
import stacLayer from 'stac-layer';

// create your Leaflet map
const map = L.map('map');

// set options for the STAC layer
const options = {
  // see table below for supported options, for example:
  resolution: 128,
  map
};

const data = fetch('https://example.com/stac/item.json')

// create layer
const layer = stacLayer(data, options);

// if the map option has not been provided:
// add layer to map and fit map to layer 
// layer.addTo(map);
// map.fitBounds(layer.getBounds());
```

## Parameters

The first parameter `data` is the STAC entity.
It can be provided as a plain JavaScript object (i.e. a deserialized STAC JSON) or
you can project a [stac-js](https://github.com/m-mohr/stac-js) object.
- STAC Collection (stac-js: `Collection`)
- STAC Item (stac-js: `Item`)
- STAC API Collections (stac-js: `CollectionCollection`)
- STAC API Items  (stac-js: `ItemCollection`)

The second parameter `options` allows to customize stac-layer.
The following options are supported:

### assets
> array of objects or strings (default: undefined)

If you want to show specific assets, provide them as an array here.
The array can contain either the asset keys (as strings) or asset objects (plain or stac.js).
Passing assets via this option will override `displayPreview` and `displayOverview`.

### bands
> array of numbers (default: undefined)

An array mapping the bands to the output bands. The following lengths are supported:
- `1`: Grayscale only
- `2`: Grayscale + Alpha
- `3`: RGB only
- `4`: RGB + Alpha

### baseUrl
> string (default: the self link of the STAC entity)

The base URL for relative links.
Should be provided if the STAC data has no self link and links are not absolute.

### crossOrigin
> string\|null (default: undefined)

The value for the [`crossorigin` attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/crossorigin) that is set when loading images through the browser.

### displayGeoTiffByDefault
> boolean (default: false)

Allow to display non-cloud-optimized GeoTiffs by default, which might not work well for larger files.

### displayPreview
> boolean (default: false)

Allow to display images that a browser can display (e.g. PNG, JPEG), usually assets with role `thumbnail` or the link with relation type `preview`.
The previews are usually not covering the full extents and as such may be placed incorrectly on the map.
For performance reasons, it is recommended to enable this option if you pass in STAC API Items.

### displayOverview
> boolean (default: true)

Allow to display COGS and/or GeoTiffs (depending on `displayGeoTiffByDefault`), usually the assets with role `overview` or `visual`.

For performance reasons, it is recommended to disable this option if you pass in STAC API Items.

### debugLevel
> boolean (default: 0)

The higher the value the more debugging messages will be logged to the console. `0` to disable logging.

### resolution
> integer (default: 32)

Adjust the display resolution, a power of two such as 32, 64, 128 or 256. By default the value is set to render quickly, but with limited resolution. Increase this value for better resolution, but slower rendering speed (e.g., 128).

### Styling

#### boundsStyle
> object (default: *Leaflet defaults, but `{fillOpacity: 0}` may be set if layers are shown inside of the bounds*)

[Leaflet Path](https://leafletjs.com/reference.html#path-option) (i.e. the vector style) for the bounds / footprint of the container.

#### collectionStyle
> object (default: *Leaflet default, but `{fillOpacity: 0, weight: 1, color: '#ff8833'}`*)

[Leaflet Path](https://leafletjs.com/reference.html#path-option) (i.e. the vector style) for individual items of API Items (ItemCollection) or collections of API Collections.

### Display specific assets

#### bbox / latLngBounds
> 1. [latLngBounds](https://leafletjs.com/reference.html#latlngbounds)
> 2. [West, South, East, North]
> 
> Default: undefined

Provide one of these options if you want to override the bounding box for a STAC Asset.

### Using a Tiler

There's are a couple different ways to use a tiler to serve images of assets 
that are Cloud-Optimized GeoTIFFs.

**Note:** To enforce using server-side rendering of imagery `useTileLayerAsFallback` must be set to `false` and either `tileUrlTemplate` or `buildTileUrlTemplate` must be given.

#### buildTileUrlTemplate
> function (default: undefined)

If you need more dynamic customization, consider passing in a `buildTileUrlTemplate` function. You can use this function to change the tile url and its parameters depending on the 
type of asset.

```js
const layer = stacLayer(data, {
  buildTileUrlTemplate: ({
    href, // the url to the GeoTIFF
    asset, // the STAC Asset object
    key, // the key or name in the assets object that points to the particular asset
    stac, // the STAC Item or STAC Collection, if available
    bounds, // LatLngBounds of the STAC asset
    isCOG: true, // true if the asset is definitely a cloud-optimized GeoTIFF
  }) => {
    let bands = asset.findVisualBands();
    if (!bands) {
      return "https://tiles.rdnt.io/tiles/{z}/{x}/{y}@2x?url={url}";
    }
    else {
      let indices = [
        bands.red.index,
        bands.green.index,
        bands.blue.index
      ].join(',');
      return "https://tiles.rdnt.io/tiles/{z}/{x}/{y}@2x?url={url}&bands=" + indices;
    }
  }
});
```

### tileUrlTemplate
> string (default: undefined)

You can set `tileUrlTemplate`, which will be passed to Leaflet's [TileLayer](https://leafletjs.com/reference-1.7.1.html#tilelayer). This will apply to whichever asset stac-layer chooses as the best GeoTIFF for visualization.
```js
// a STAC Feature
const layer = stacLayer(data, {
  tileUrlTemplate: "https://tiles.rdnt.io/tiles/{z}/{x}/{y}@2x?url={url}"
});
```

### useTileLayerAsFallback
> boolean (default: false)

Enables server-side rendering of imagery in case an error has happened on the client-side.
If you'd like to only use a tiler if [GeoRasterLayer](https://github.com/geotiff/georaster-layer-for-leaflet) fails, set `useTileLayerAsFallback` to `true`.

```js
const layer = stacLayer(data, {
  tileUrlTemplate: "https://tiles.rdnt.io/tiles/{z}/{x}/{y}@2x?url={url}",
  useTileLayerAsFallback: true
});
```

## Events

## `click`: listening to click events

STAC Layer added a "stac" property to Leaflet's onClick events that include the STAC information of what the user clicked. It can be a STAC collection, feature, asset, or even an array of assets when a composite of multiple assets are being visualized.

```js
const featureCollection = ....; // a GeoJSON Feature Collection of STAC Features

const layer = stacLayer(featureCollection);
layer.on("click", event => {
  const { type, data } = event.stac;
  // type is one of "Collection", "CollectionCollection", "Feature", "FeatureCollection" or "Asset"
  // data is the item that was clicked in the collection
});
```

## `loaded`: once all imagery is shown

Sometimes you might like to know information about what is being visualized.
You can access this information through the `loaded` event.

```js
const layer = stacLayer(data, options);
layer.on("loaded", event => {
  const { data, geojson, boundsLayer } = event;
  // data is the stac-js object shown
  // boundsLayer is a Leaflet layer object for the bounds
  // geojson can be a GeoJSON object of the bounds
});
```

## `imageLayerAdded`: once a new image layer is added

Whenever a new layer with imagery is added to the map.
Helps to get information about which data is being visualized.
Has parameters: `type`, `layer`, `asset`

Multiple types are possible:
- `tilelayer` A tile server layer. 
- `overview` Overview imagery layer, usually a GeoTiff or COG.
- `preview` Preview imagery layer, usually a thumbnail in a browser-supported format such as PNG or JPEG.

```js
const layer = stacLayer(data, options);
layer.on("imageLayerAdded", event => {
  const { type, layer, asset } = event;
  // type is the type of the layer
  // layer is the Leaflet layer object
  // asset can be a stac-js asset object
});
```

## `fallback`: listening to fallback events

STAC Layer fires a custom "fallback" event when an error occurs rendering
with GeoRasterLayer and it falls back to trying to use a tiler.

```js
const layer = stacLayer(data, options);
layer.on("fallback", event => {
  // event.error is the initial LeafletJS error event
  // that triggered the fallback
});
```
