import TiTiler from "./titiler.js";

export default async function tiTilerLayer ({ assets, debugLevel=0, titiler, quiet=false, url }) {
  try {
    if (!titiler) throw new Error("[titiler-layer] you must specify a url to an instance of TiTiler");
    if (!url) throw new Error("[titiler] you must specify a url to the data that you want to visualize");

    if (debugLevel >= 1) console.log("[titiler-layer] assets:", assets);
    if (debugLevel >= 1) console.log("[titiler-layer] debugLevel:", debugLevel);
    if (debugLevel >= 1) console.log("[titiler-layer] titiler:", titiler);
    if (debugLevel >= 1) console.log("[titiler-layer] quiet:", quiet);
    if (debugLevel >= 1) console.log("[titiler-layer] url:", url);


    const client = await TiTiler({ url: titiler });
    if (debugLevel >= 2) console.log("[titiler-layer] client:", client);

    const supportedAssets = await client.stac.assets.get({ url });
    if (debugLevel >= 2)
      console.log("[titiler-layer] the following assets are supported via titiler" + supportedAssets);

    if (!assets.every(asset => supportedAssets.includes(asset))) {
      const msg = "[titiler-layer] one or more of the provided assets are not supported";
      if (debugLevel >= 2) console.log(msg);
      if (quiet) return;
      throw new Error(msg);
    }

    try {
      console.log(
        "[stac-layer] issuing test request to see if we can fetch tiles through the titiler instance"
      );
      await titiler.stac.tiles.get({ x: 0, y: 0, z: 0, url, assets });
    } catch (error) {
      const msg = (
        "[titiler-layer] we cannot fetch tiles through TiTiler. please consult the network tab in your Dev Tools to see why the request failed. " +
          "This can sometimes happen because the TiTiler instance is not reachable or the url is to a requester pays bucket on AWS S3 and " +
          "the TiTiler instance is not set up to pay for requests."
      );
      if (debugLevel >= 2) console.log(msg);
      if (quiet) return;
      throw new Error(msg);
    }
    const tileUrlTemplate = `${options.titiler}/stac/tiles?url=${encodeURIComponent(
      selfHref
    )}&assets=${encodeURIComponent(assetNames.toString())}`;
    const tileLayerOptions = { bounds, ...options };
    const tileLayer = L.tileLayer(tileUrlTemplate, tileLayerOptions);
    return tileLayer;
  } catch (error) {
    if (debugLevel >= 2) console.log(error);
    if (quiet) return;
    throw new Error(error);
  }
};
