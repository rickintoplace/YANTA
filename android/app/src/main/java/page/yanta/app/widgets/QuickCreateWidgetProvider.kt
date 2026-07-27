package page.yanta.app.widgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import page.yanta.app.R
import page.yanta.app.widgets.data.CalendarWidgetStore
import page.yanta.app.widgets.render.setThemedTextColor
import page.yanta.app.widgets.render.tint
import page.yanta.app.widgets.ui.WidgetIntents
import page.yanta.app.widgets.ui.WidgetTheme

/**
 * Quick create: the fastest path from the home screen into a new note,
 * folder, event, source or the assistant.
 *
 * The action strip is filled at render time so a narrow widget shows fewer
 * actions at full size instead of five cramped ones, and labels disappear
 * before the icons do when the widget is only one row tall.
 */
class QuickCreateWidgetProvider : AppWidgetProvider() {

    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()

        WidgetWork.execute {
            try {
                super.onReceive(context, intent)
            } finally {
                pending.finish()
            }
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { render(context, manager, it) }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        widgetId: Int,
        newOptions: Bundle?,
    ) {
        render(context, manager, widgetId)
    }

    private data class QuickAction(
        val id: String,
        val iconRes: Int,
        val labelRes: Int,
    )

    companion object {

        /** Ordered by how often they are reached for; the tail drops first. */
        private val ACTIONS = listOf(
            QuickAction("quick_note", R.drawable.ic_widget_note, R.string.widget_quick_note),
            QuickAction("quick_event", R.drawable.ic_widget_event, R.string.widget_quick_event),
            QuickAction("quick_folder", R.drawable.ic_widget_folder, R.string.widget_quick_folder),
            QuickAction("ai", R.drawable.ic_widget_ai, R.string.widget_quick_ai),
            QuickAction("sources", R.drawable.ic_widget_rss, R.string.widget_quick_sources),
        )

        private const val ACTION_WIDTH_DP = 62
        private const val LABEL_MIN_HEIGHT_DP = 84

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                ComponentName(context, QuickCreateWidgetProvider::class.java)
            )

            ids.forEach { render(context, manager, it) }
        }

        private fun render(context: Context, manager: AppWidgetManager, widgetId: Int) {
            val theme = WidgetTheme.resolve(context, CalendarWidgetStore.read(context).theme)
            val options = runCatching { manager.getAppWidgetOptions(widgetId) }.getOrNull()

            val widthDp = options
                ?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
                ?.takeIf { it > 0 } ?: FALLBACK_WIDTH_DP

            val heightDp = options
                ?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
                ?.takeIf { it > 0 } ?: FALLBACK_HEIGHT_DP

            val views = RemoteViews(context.packageName, R.layout.widget_quick_create)

            views.tint(R.id.widget_background, theme.background, theme)
            views.setOnClickPendingIntent(
                R.id.widget_background,
                WidgetIntents.quickAction(context, widgetId, "open", 0),
            )

            val visibleActions = (widthDp / ACTION_WIDTH_DP).coerceIn(1, ACTIONS.size)
            val showLabels = heightDp >= LABEL_MIN_HEIGHT_DP

            views.removeAllViews(R.id.quick_actions)
            ACTIONS.take(visibleActions).forEachIndexed { index, action ->
                views.addView(
                    R.id.quick_actions,
                    actionView(context, widgetId, action, index, theme, showLabels),
                )
            }

            runCatching { manager.updateAppWidget(widgetId, views) }
        }

        private fun actionView(
            context: Context,
            widgetId: Int,
            action: QuickAction,
            index: Int,
            theme: WidgetTheme,
            showLabel: Boolean,
        ): RemoteViews {
            val label = context.getString(action.labelRes)
            val views = RemoteViews(context.packageName, R.layout.widget_quick_action)

            views.tint(R.id.action_background, theme.accent, theme, ACCENT_WASH_ALPHA)

            views.setImageViewResource(R.id.action_icon, action.iconRes)
            views.tint(R.id.action_icon, theme.accent, theme)

            views.setViewVisibility(
                R.id.action_label,
                if (showLabel) View.VISIBLE else View.GONE,
            )
            views.setTextViewText(R.id.action_label, label)
            views.setThemedTextColor(R.id.action_label, theme.textDim, theme)

            views.setContentDescription(R.id.action_root, label)
            views.setOnClickPendingIntent(
                R.id.action_root,
                // Lane offset keeps the five actions distinct per widget.
                WidgetIntents.quickAction(context, widgetId, action.id, index + 1),
            )

            return views
        }

        private const val ACCENT_WASH_ALPHA = 46
        private const val FALLBACK_WIDTH_DP = 250
        private const val FALLBACK_HEIGHT_DP = 60
    }
}
