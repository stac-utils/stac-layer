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
import STACLayer from 'stac-layer';

// create your Leaflet map
const map = L.map('map');

// create layer
const layer = new STACLayer(
  data,
  {
    displayPreview: false
  }
);

// fit map to layer
map.fitBounds(layer.getBounds());

// display just one band
const layer = new StacLayer(
  data,
  {
    band: 0 // starting at zero
  }
)
```