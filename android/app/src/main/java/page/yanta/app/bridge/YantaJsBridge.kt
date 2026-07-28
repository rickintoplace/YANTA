package page.yanta.app.bridge

import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import page.yanta.app.BuildConfig
import page.yanta.app.MainActivity
import page.yanta.app.data.NativeStore
import page.yanta.app.notifications.ChatNotifier
import page.yanta.app.notifications.NotificationScheduler
import page.yanta.app.push.PushTokenStore
import page.yanta.app.shortcuts.YantaShortcuts
import page.yanta.app.widgets.YantaWidgetUpdater

class YantaJsBridge(
    private val activity: MainActivity,
    private val webView: WebView,
    private val onRequestNotificationPermission: () -> Unit,
    private val onOpenNotificationSettings: () -> Unit,
    private val onOpenExactAlarmSettings: () -> Unit,
) {

    // ------------------------------------------------------------
    // Existing notification / system bridge
    // ------------------------------------------------------------

    @JavascriptInterface
    fun getNotificationStatus(): String = activity.notificationStatusJson()

    @JavascriptInterface
    fun requestNotificationPermission() {
        activity.runOnUiThread { onRequestNotificationPermission() }
    }

    @JavascriptInterface
    fun openNotificationSettings() {
        activity.runOnUiThread { onOpenNotificationSettings() }
    }

    @JavascriptInterface
    fun openExactAlarmSettings() {
        activity.runOnUiThread { onOpenExactAlarmSettings() }
    }

    @JavascriptInterface
    fun setSystemBarsAppearance(backgroundColor: String, useDarkIcons: Boolean) {
        activity.runOnUiThread {
            activity.setSystemBarsAppearance(backgroundColor, useDarkIcons)
        }
    }

    /**
     * Whether the web layer still has an in-app entry to go back to.
     * Drives the predictive-back callback: only while this is false does
     * the system play its back-to-home preview — see MainActivity.
     * Called from installPredictiveBack() in src/native/predictive-back.js.
     */
    @JavascriptInterface
    fun setBackState(canGoBack: Boolean) {
        activity.runOnUiThread { activity.setWebBackState(canGoBack) }
    }

    @JavascriptInterface
    fun syncNativeSnapshot(json: String) {
        NativeStore.saveSnapshot(activity, json)
        NotificationScheduler.scheduleFromSnapshot(activity, json)
        YantaWidgetUpdater.requestUpdate(activity)
        YantaShortcuts.updateDynamicShortcuts(activity, json)
    }

    // ------------------------------------------------------------
    // Home-screen widgets
    // ------------------------------------------------------------

    /**
     * How many widgets of each kind are placed, so the web layer can skip
     * building a payload nothing renders. See androidWidgetState() in
     * src/native/android-bridge.js.
     */
    @JavascriptInterface
    fun getWidgetState(): String = YantaWidgetUpdater.stateJson(activity)

    /**
     * Display payload for the calendar widgets — see
     * collectCalendarWidgetPayload() in src/native/android-bridge.js.
     * Kept separate from the notification snapshot: this one is large and
     * only read when a widget redraws.
     */
    @JavascriptInterface
    fun syncCalendarWidgetData(json: String) {
        YantaWidgetUpdater.requestCalendarDataSync(activity, json)
    }

    @JavascriptInterface
    fun log(message: String) {
        android.util.Log.d("YANTA-Web", message)
    }

    /**
     * Share sheet: returns (and clears) the pending shared payload JSON, or
     * "null". The web layer pulls this once ready and on the
     * yanta-android-share-available nudge — see android-bridge.js.
     */
    @JavascriptInterface
    fun consumeSharedPayload(): String = activity.takeSharedPayloadJson()

    /**
     * Widget / launcher-shortcut action that cold-started the app, as
     * { action, params }. Pulled by consumeNativeQuickAction() once the
     * first surface is interactive — see src/native/android-bridge.js.
     */
    @JavascriptInterface
    fun consumePendingAction(): String = activity.takePendingActionJson()

    // ------------------------------------------------------------
    // Chat push (Matrix HTTP pusher config)
    // ------------------------------------------------------------

    /**
     * Contract expected by src/native/android-bridge.js → androidChatPushConfig().
     * Returns "null" until the FCM token exists (first token arrives async).
     * The web layer retries on yanta-chat-ready and on token-change events.
     */
    @JavascriptInterface
    fun getChatPushConfig(): String {
        val token = PushTokenStore.token(activity)
        if (token.isBlank()) return "null"
        return JSONObject()
            .put("pushkey", token)
            .put("gatewayUrl", BuildConfig.YANTA_PUSH_GATEWAY_URL)
            .put("appId", "page.yanta.app")
            .put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            .toString()
    }

    // ------------------------------------------------------------
    // Chat notifications (app open — web has decrypted content)
    // ------------------------------------------------------------

    /**
     * Payload from chat-notifications.js:
     * { roomId, eventId, title, body, roomName, sender, url, ts }
     */
    @JavascriptInterface
    fun showChatNotification(json: String) {
        val payload = runCatching { JSONObject(json) }.getOrNull() ?: return
        val roomId = payload.optString("roomId")
        if (roomId.isBlank()) return
        ChatNotifier.showMessage(
            context = activity,
            roomId = roomId,
            title = payload.optString("title", "New message"),
            body = payload.optString("body", ""),
            timestamp = payload.optLong("ts", System.currentTimeMillis()),
        )
    }

    /** Empty roomId clears all chat notifications. */
    @JavascriptInterface
    fun clearChatNotifications(roomId: String) {
        ChatNotifier.clear(activity, roomId)
    }

    /**
     * Launcher badges on modern Android derive from active notifications;
     * the count is persisted so future badge APIs/widgets can use it.
     */
    @JavascriptInterface
    fun setChatUnreadCount(count: String) {
        NativeStore.saveChatUnreadCount(activity, count.toIntOrNull() ?: 0)
    }

    // ------------------------------------------------------------
    // Chat media capabilities (mic / gallery)
    // ------------------------------------------------------------

    /**
     * Contract expected by androidChatMediaStatus() in android-bridge.js.
     * filePickerSupported is always true: gallery access uses the system
     * file chooser / photo picker and needs no storage permission on API 29+.
     */

    @JavascriptInterface
    fun getChatMediaStatus(): String {
        return JSONObject()
            .put("micGranted", activity.isMicrophoneGranted())
            .put("cameraGranted", activity.isCameraGranted())
            .put("filePickerSupported", true)
            .put("storageGranted", true)
            .toString()
    }
}
