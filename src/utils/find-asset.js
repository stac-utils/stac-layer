/**
 * @name findAsset
 * @description finds the asset that matches the given role
 * @param {Object} assets
 * @param {String} requiredRole
 * @returns {Object} asset
 */
export default function findAsset(assets, requiredRole) {
  for (let key in assets) {
    const asset = assets[key];
    if (key.toLowerCase() === requiredRole) {
      return { key, asset };
    } else if (Array.isArray(asset.roles) && asset.roles.find(role => role.toLowerCase() === requiredRole)) {
      return { key, asset };
    }
  }
}
