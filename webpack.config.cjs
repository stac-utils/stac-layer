const envisage = require("envisage");
const path = require("path");

const config = {
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
          loader: "babel-loader",
          options: {
            "presets": [
              [
                "@babel/preset-env",
                {
                  "targets": {
                    "ie": 11
                  }
                }
              ]
            ],
            "plugins": [
              "@babel/plugin-proposal-nullish-coalescing-operator",
              "@babel/plugin-proposal-optional-chaining"
            ]
          }
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

envisage.assign({ target: config, prefix: "WEBPACK" });

module.exports = config;
