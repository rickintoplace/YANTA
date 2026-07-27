package page.yanta.app.widgets.data

import android.content.Context
import androidx.core.content.edit
import page.yanta.app.R

/**
 * The actions a Quick Create widget can offer.
 *
 * Ids are the app's own CREATE_ACTIONS ids (src/create-actions.js), so a
 * widget tap runs exactly what the in-app create menu runs — the native
 * side never reimplements what an action does.
 */
enum class QuickAction(
    val id: String,
    val iconRes: Int,
    val labelRes: Int,
) {
    CAPTURE("capture", R.drawable.ic_widget_capture, R.string.widget_action_capture),
    NOTE("note", R.drawable.ic_widget_note, R.string.widget_action_note),
    EVENT("event", R.drawable.ic_widget_event, R.string.widget_action_event),
    CHAT("chat", R.drawable.ic_widget_chat, R.string.widget_action_chat),
    AI("ai", R.drawable.ic_widget_ai, R.string.widget_action_ai),
    SOURCES("rss", R.drawable.ic_widget_rss, R.string.widget_action_sources),
    CHECKLIST("list", R.drawable.ic_widget_checklist, R.string.widget_action_checklist),
    DRAWING("drawing", R.drawable.ic_widget_drawing, R.string.widget_action_drawing),
    IMAGE("image", R.drawable.ic_widget_image, R.string.widget_action_image),
    FOLDER("folder", R.drawable.ic_widget_folder, R.string.widget_action_folder);

    companion object {
        /** Fastest-path actions first; the rest stay one tap away in the picker. */
        val DEFAULT = listOf(CAPTURE, NOTE, EVENT, CHAT, AI, SOURCES)

        fun fromId(id: String?): QuickAction? = entries.firstOrNull { it.id == id }
    }
}

/**
 * Which actions a Quick Create widget shows, and in which order.
 *
 * Stored per widget instance, so the same provider can be a six-action bar
 * on one home screen and a single-purpose 1x1 button on another.
 */
object QuickCreateSettings {

    private const val PREFS = "yanta_widgets"
    private const val KEY_ACTIONS = "quick_actions_"

    private const val SEPARATOR = ","

    fun actions(context: Context, widgetId: Int): List<QuickAction> =
        storedActions(context, widgetId) ?: QuickAction.DEFAULT

    /** Null while the widget has never been configured. */
    fun storedActions(context: Context, widgetId: Int): List<QuickAction>? =
        prefs(context).getString(KEY_ACTIONS + widgetId, null)
            ?.split(SEPARATOR)
            ?.mapNotNull(QuickAction::fromId)
            ?.takeIf { it.isNotEmpty() }

    fun setActions(context: Context, widgetId: Int, actions: List<QuickAction>) {
        prefs(context).edit {
            putString(KEY_ACTIONS + widgetId, actions.joinToString(SEPARATOR) { it.id })
        }
    }

    fun forget(context: Context, widgetIds: IntArray) {
        prefs(context).edit {
            widgetIds.forEach { remove(KEY_ACTIONS + it) }
        }
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
