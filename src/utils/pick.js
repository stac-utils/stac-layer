export default function pick(obj, keys) {
  const result = {};
  keys.forEach(key => {
    result[key] = obj[key];
  });
  return result;
}
