export default function range(count) {
  return new Array(count).fill(null).map((_, i) => i);
}
