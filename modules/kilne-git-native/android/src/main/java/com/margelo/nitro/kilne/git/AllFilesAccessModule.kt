package com.margelo.nitro.kilne.git

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

/**
 * All Files Access (`MANAGE_EXTERNAL_STORAGE`) helpers.
 *
 * Android 11+ has no runtime permission dialog for this — the user must flip a
 * Settings toggle. Without it, MediaProvider FUSE filters `readdir` so Obsidian-
 * created files never appear as untracked to libgit2.
 */
@ReactModule(name = AllFilesAccessModule.NAME)
class AllFilesAccessModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun isExternalStorageManager(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
        promise.resolve(true)
        return
      }
      promise.resolve(Environment.isExternalStorageManager())
    } catch (e: Exception) {
      promise.reject("E_ALL_FILES_CHECK", e.message, e)
    }
  }

  @ReactMethod
  fun openSettings(promise: Promise) {
    try {
      val pkg = reactContext.packageName
      try {
        val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
          data = Uri.parse("package:$pkg")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactContext.startActivity(intent)
      } catch (_: Exception) {
        val intent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactContext.startActivity(intent)
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_ALL_FILES_SETTINGS", e.message, e)
    }
  }

  companion object {
    const val NAME = "KilneAllFilesAccess"
  }
}
