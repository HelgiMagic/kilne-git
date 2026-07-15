/**
 * React Native CLI config so autolinking picks up this local module.
 * See https://github.com/react-native-community/cli/blob/master/docs/autolinking.md
 */
module.exports = {
  dependencies: {
    'kilne-git-native': {
      root: __dirname,
    },
    'react-native-nitro-modules': {
      root: path.join(__dirname, '..', 'node_modules', 'react-native-nitro-modules'),
    },
  },
};
