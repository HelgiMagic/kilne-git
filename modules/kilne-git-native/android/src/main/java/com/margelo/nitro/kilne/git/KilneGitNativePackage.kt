package com.margelo.nitro.kilne.git

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Autolinked React Package whose only job is to load `libKilneGitNative.so`
 * (via [KilneGitNativeOnLoad.initializeNative]) so JNI_OnLoad registers the
 * `Git` HybridObject before JS calls `NitroModules.createHybridObject('Git')`.
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
  ): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider { emptyMap() }
}
