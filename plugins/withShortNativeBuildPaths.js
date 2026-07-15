/**
 * Relocates AGP CMake staging dirs (.cxx) to a short Windows path.
 *
 * Windows-only: deep project paths + NDK object names can exceed
 * CMAKE_OBJECT_PATH_MAX (~250). On Linux/macOS this plugin is a no-op.
 *
 * Hooks via settings.gradle `gradle.beforeProject` (not root build.gradle
 * `subprojects`) because Expo uses `--configure-on-demand`.
 */
const {
  withSettingsGradle,
  createRunOncePlugin,
} = require('expo/config-plugins');

const TAG = 'withShortNativeBuildPaths';

const SNIPPET = `
// [${TAG}] Short CMake staging dirs — avoids Windows CMAKE_OBJECT_PATH_MAX.
// Registered in settings so it runs before each project evaluates (required
// with --configure-on-demand). Windows-only.
gradle.beforeProject { project ->
  if (project.path == ":") return
  if (!System.getProperty("os.name", "").toLowerCase().contains("windows")) return
  def shortCxxDir = new File("C:/cxx/\${rootProject.name}/\${project.name}")
  def applyShortCxx = {
    def androidExt = project.extensions.findByName("android")
    if (androidExt == null) return
    androidExt.externalNativeBuild.cmake.buildStagingDirectory = shortCxxDir
  }
  project.pluginManager.withPlugin("com.android.library", applyShortCxx)
  project.pluginManager.withPlugin("com.android.application", applyShortCxx)
}
`;

function withShortNativeBuildPaths(config) {
  return withSettingsGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      return config;
    }
    const contents = config.modResults.contents;
    if (contents.includes(`[${TAG}]`)) {
      return config;
    }
    config.modResults.contents = `${contents.trimEnd()}\n${SNIPPET}\n`;
    return config;
  });
}

module.exports = createRunOncePlugin(
  withShortNativeBuildPaths,
  'with-short-native-build-paths',
  '1.2.0',
);
