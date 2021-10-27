import URI from "urijs";

import isRelative from "./is-relative.js";

export default function toAbsolute(href, baseUrl, stringify = true) {
  let uri = URI(href);
  if (isRelative(uri)) {
    uri = uri.absoluteTo(baseUrl);
  }
  return stringify ? uri.toString() : uri;
}
