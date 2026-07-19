package page.yanta.app.data

import android.content.Context

object NativeStore {

    private const val PREFS = "yanta_native_store"
    private const val KEY_SNAPSHOT = "snapshot_json"
    private const val KEY_ALARM_CODES = "alarm_codes"
    private const val KEY_CHAT_UNREAD = "chat_unread_count"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun saveSnapshot(context: Context, json: String) {
        prefs(context).edit().putString(KEY_SNAPSHOT, json).apply()
    }

    fun snapshot(context: Context): String =
        prefs(context).getString(KEY_SNAPSHOT, "{}") ?: "{}"

    fun saveAlarmCodes(context: Context, codes: Set<Int>) {
        prefs(context).edit()
            .putStringSet(KEY_ALARM_CODES, codes.map { it.toString() }.toSet())
            .apply()
    }

    fun alarmCodes(context: Context): Set<Int> =
        prefs(context).getStringSet(KEY_ALARM_CODES, emptySet())
            ?.mapNotNull { it.toIntOrNull() }
            ?.toSet()
            ?: emptySet()

    fun saveChatUnreadCount(context: Context, count: Int) {
        prefs(context).edit().putInt(KEY_CHAT_UNREAD, count.coerceAtLeast(0)).apply()
    }

    fun chatUnreadCount(context: Context): Int =
        prefs(context).getInt(KEY_CHAT_UNREAD, 0)
}
