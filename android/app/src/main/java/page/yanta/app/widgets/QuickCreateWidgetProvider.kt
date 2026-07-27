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
import page.yanta.app.widgets.data.QuickAction
import page.yanta.app.widgets.data.QuickCreateSettings
import page.yanta.app.widgets.render.setThemedTextColor
import page.yanta.app.widgets.render.tint
import page.yanta.app.widgets.ui.WidgetIntents
import page.yanta.app.widgets.ui.WidgetTheme

/**
 * Quick create: the fastest path from the home screen into a new note,
 * capture, event, chat or the assistant.
 *
 * Which actions appear, and in what order, is per widget instance — the
 * same provider is a six-action bar on one home screen and a single-purpose
 * 1x1 button on another. The renderer only decides how much room each
 * chosen action gets, never which ones survive: dropping an action the user
 * explicitly picked would be the widget overruling its owner.
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

    override fun onDeleted(context: Context, ids: IntArray) {
        QuickCreateSettings.forget(context, ids)
    }

    companion object {

        /** Below this much room per action the compact variant is used. */
        private const val COMPACT_ACTION_DP = 52

        /** Labels need a second row of text under a 40dp circle. */
        private const val LABEL_MIN_HEIGHT_DP = 84

        private const val FALLBACK_WIDTH_DP = 250
        private const val FALLBACK_HEIGHT_DP = 60

        private const val ACCENT_WASH_ALPHA = 46

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                ComponentName(context, QuickCreateWidgetProvider::class.java)
            )

            ids.forEach { render(context, manager, it) }
        }

        fun render(context: Context, manager: AppWidgetManager, widgetId: Int) {
            val theme = WidgetTheme.resolve(context, CalendarWidgetStore.read(context).theme)
            val options = runCatching { manager.getAppWidgetOptions(widgetId) }.getOrNull()

            val widthDp = options
                ?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
                ?.takeIf { it > 0 } ?: FALLBACK_WIDTH_DP

            val heightDp = options
                ?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
                ?.takeIf { it > 0 } ?: FALLBACK_HEIGHT_DP

            val actions = QuickCreateSettings.actions(context, widgetId)
            val perActionDp = widthDp / actions.size.coerceAtLeast(1)

            val compact = perActionDp < COMPACT_ACTION_DP
            val showLabels = !compact && heightDp >= LABEL_MIN_HEIGHT_DP

            val views = RemoteViews(context.packageName, R.layout.widget_quick_create)

            views.tint(R.id.widget_background, theme.background, theme)
            views.setOnClickPendingIntent(
                R.id.widget_background,
                WidgetIntents.openConfig(context, widgetId, QuickCreateConfigActivity::class.java),
            )

            views.removeAllViews(R.id.quick_actions)
            actions.forEachIndexed { index, action ->
                views.addView(
                    R.id.quick_actions,
                    actionView(context, widgetId, action, index, theme, compact, showLabels),
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
            compact: Boolean,
            showLabel: Boolean,
        ): RemoteViews {
            val label = context.getString(action.labelRes)
            val layout = if (compact) {
                R.layout.widget_quick_action_small
            } else {
                R.layout.widget_quick_action
            }

            val views = RemoteViews(context.packageName, layout)

            views.tint(R.id.action_background, theme.accent, theme, ACCENT_WASH_ALPHA)

            views.setImageViewResource(R.id.action_icon, action.iconRes)
            views.tint(R.id.action_icon, theme.accent, theme)

            if (!compact) {
                views.setViewVisibility(
                    R.id.action_label,
                    if (showLabel) View.VISIBLE else View.GONE,
                )
                views.setTextViewText(R.id.action_label, label)
                views.setThemedTextColor(R.id.action_label, theme.textDim, theme)
            }

            views.setContentDescription(R.id.action_root, label)
            views.setOnClickPendingIntent(
                R.id.action_root,
                // Lane offset keeps the actions of one widget distinct.
                WidgetIntents.quickAction(context, widgetId, action.id, index + 1),
            )

            return views
        }
    }
}
