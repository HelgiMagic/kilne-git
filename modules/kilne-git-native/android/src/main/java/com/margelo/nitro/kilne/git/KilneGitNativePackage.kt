package com.margelo.nitro.kilne.git

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Autolinked React Package:
 * - Loads `libKilneGitNative.so` so JNI_OnLoad registers the `Git` HybridObject.
 * - Registers [AllFilesAccessModule] for `Environment.isExternalStorageManager()`.
 */
class KilneGitNativePackage : BaseReactPackage() {
  companion object {
    init {
      KilneGitNativeOnLoad.initializeNative()
    }
  }

  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext,
  ): NativeModule? =
    if (name == AllFilesAccessModule.NAME) {
      AllFilesAccessModule(reactContext)
    } else {
      null
    }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        AllFilesAccessModule.NAME to
          ReactModuleInfo(
            AllFilesAccessModule.NAME,
            AllFilesAccessModule::class.java.name,
            false, // canOverrideExistingModule
            false, // needsEagerInit
            false, // isCxxModule
            false, // isTurboModule — classic NativeModule via interop
          ),
      )
    }
}
