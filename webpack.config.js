var webpack = require('webpack');
var ignore = new webpack.IgnorePlugin(/^(unirest)$/);

module.exports = {
  entry: './web/export.js',
  output: {
    filename: './web/unidisk.js'
  },
  node: {
    fs: "empty",
    unirest: "empty",
    dgram: "empty",
    dns: "empty"
  },
  plugins: [ignore],
  module: {
    loaders: [
    ]
  }
};
