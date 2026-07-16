/**
 * React Native CLI config so autolinking picks up this local Nitro module.
 * Registers KilneGitNativePackage, whose static init loads libKilneGitNative.so.
 *
 * https://github.com/react-native-community/cli/blob/main/docs/dependencies.md
 */
module.exports = {
  dependency: {
    platforms: {
      android: {
        packageImportPath:
          'import com.margelo.nitro.kilne.git.KilneGitNativePackage;',
        packageInstance: 'new KilneGitNativePackage()',
        // CMake is owned by this module's build.gradle (externalNativeBuild),
        // not by RN Fabric codegen — leave cmakeListsPath unset.
      },
      ios: {},
    },
  },
};
