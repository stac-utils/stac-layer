const path = require("path");

module.exports = {
  watch: process.env.WEBPACK_WATCH === "true",
  entry: "./src/index.js",
  mode: "production",
  target: "web",
  output: {
    filename: "stac-layer.min.js",
    path: path.resolve(__dirname, "dist"),
    library: {
      export: "default",
      name: "STACLayer",
      type: "umd"
    }
  },
  devtool: "source-map",
  module: {
    rules: [
      {
        test: /\.(ts|js)x?$/,
        use: {
          loader: "babel-loader"
        }
      }
    ].filter(Boolean)
  },
  resolve: {
    modules: ["node_modules"]
  },
  externals: {
    leaflet: {
      root: "L",
      commonjs: "leaflet",
      amd: "leaflet",
      commonjs2: "leaflet"
    }
  }
};
