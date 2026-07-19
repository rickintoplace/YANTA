package page.yanta.app.push

import android.content.Context

/**
 * Device-local store for the FCM push token.
 *
 * The token is the Matrix pusher `pushkey`. The web layer reads it via
 * YantaJsBridge.getChatPushConfig() and registers the HTTP pusher itself,
 * so the native side never talks to the Matrix homeserver directly.
 */
object PushTokenStore {

    private const val PREFS = "yanta_push_store"
    private const val KEY_TOKEN = "fcm_token"
    private const val KEY_DISPATCHED = "fcm_token_dispatched"

    /**
     * Optional in-process listener. MainActivity registers it while alive so a
     * token rotation reaches the WebView immediately (not only on next resume).
     * Called on an arbitrary thread — implementations must post to the UI thread.
     */
    @Volatile
    var onTokenChanged: ((String) -> Unit)? = null

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun token(context: Context): String =
        prefs(context).getString(KEY_TOKEN, "") ?: ""

    fun saveToken(context: Context, token: String) {
        if (token.isBlank() || token == token(context)) return
        prefs(context).edit().putString(KEY_TOKEN, token).apply()
        onTokenChanged?.invoke(token)
    }

    fun lastDispatchedToken(context: Context): String =
        prefs(context).getString(KEY_DISPATCHED, "") ?: ""

    fun markDispatched(context: Context, token: String) {
        prefs(context).edit().putString(KEY_DISPATCHED, token).apply()
    }
}
