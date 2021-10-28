import URI from "urijs";

export default function isRelative(uri) {
  return new URI(uri).is("relative");
}
