import URI from "urijs";

export default function toAbsolute(href, baseUrl, stringify = true) {
  let uri = URI(href);
  uri = uri.absoluteTo(baseUrl);
  return stringify ? uri.toString() : uri;
}
