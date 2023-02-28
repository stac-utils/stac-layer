export default class StacLayerError extends Error {
  constructor(code, message, values = {}) {
    super(message, { cause: { code, values } });
  }
}