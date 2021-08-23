# stac-layer
> Visualize [STAC](https://stacspec.org/) Data on a [LeafletJS](https://leafletjs.com/) Map

# install
```bash
npm install stac-layer
```

# supported data types
- STAC Collection
- Item Collection
- STAC API Collections
- STAC API Items
- STAC Item
- STAC Asset

# usage
```js
import stacLayer from 'stac-layer';

// create your Leaflet map
const map = L.map('map');

// create layer
const layer = await stacLayer(
  data,
  {
    displayPreview: false
  }
);

// add layer to map
layer.addTo(map);

// fit map to layer
map.fitBounds(layer.getBounds());
```

# advanced usage
## using a tiler
There's are a couple different ways to use a tiler to serve images of assets
that are Cloud-Optimized GeoTIFFs.
### tileUrlTemplate
You can set tileUrlTemplate, which will be passed to Leaflet's [TileLayer](https://leafletjs.com/reference-1.7.1.html#tilelayer).  This will apply to whichever asset stac-layer chooses as the best GeoTIFF for visualization.
```js
// a STAC Feature
const layer = await stacLayer(data, {
  tileUrlTemplate: "https://tiles.rdnt.io/tiles/{z}/{x}/{y}@2x?url={url}"
});
```
### buildTileUrlTemplate
If you need more dynamic customization, consider passing in a buildTileUrlTemplate function.
You can use this function to change the tile url and its parameters depending on the 
type of asset.
```js
const layer = await stacLayer(data, {
  buildTileUrlTemplate: ({
    href, // the url to the GeoTIFF
    asset, // the STAC Asset object
    key, // the key or name in the assets object that points to the particular asset
    item, // the STAC item / feature
    bounds, // LatLngBounds of the STAC asset
    isCOG: true, // true if the asset is definitely a cloud-optimized GeoTIFF
    isVisual: true, // true when the asset's key is "visual" (case-insensitive)
  }) => {
    // assets has three bands of RGB, so no need to specify bands
    if (isVisual) return "https://tiles.rdnt.io/tiles/{z}/{x}/{y}@2x?url={url}";

    // select first three bands for non-visual assets, such as NAIP 4-band imagery
    // where we might want to ignore the Near-Infrared Band
    else return "https://tiles.rdnt.io/tiles/{z}/{x}/{y}@2x?url={url}&bands=1,2,3"
  }
});
```

## listening to click events
STAC Layer added a "stac" property to Leaflet's onClick events that include the STAC information
of what the user clicked.  It can be a STAC collection, feature, asset, or even an array of assets
when a composite of multiple assets are being visualized.
```js
const featureCollection = ....; // a GeoJSON Feature Collection of STAC Features

const layer = stacLayer(featureCollection);
layer.on("click", e => {
  const { type, data } = e.stac;
  // type is one of "Collection", "Feature", "Assets", or "Asset"
  // data is the item that was clicked in the collection
});
```
