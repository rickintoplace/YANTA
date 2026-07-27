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
import page.yanta.app.widgets.render.setThemedTextColor
import page.yanta.app.widgets.render.tint
import page.yanta.app.widgets.ui.WidgetIntents
import page.yanta.app.widgets.ui.WidgetTheme

/**
 * Quick capture as its own widget: a prompt pill that drops straight into
 * the capture sheet, so a thought costs one tap instead of app → menu →
 * action.
 *
 * Resizes down to a single cell, where the prompt gives way to the icon —
 * at that size the widget is a button, and a clipped half-sentence would
 * only be noise.
 */
class QuickCaptureWidgetProvider : AppWidgetProvider() {

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

    companion object {

        /** Under this width the prompt is dropped and only the icon remains. */
        private const val PROMPT_MIN_WIDTH_DP = 150

        private const val FALLBACK_WIDTH_DP = 180

        private const val ACCENT_WASH_ALPHA = 46

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                ComponentName(context, QuickCaptureWidgetProvider::class.java)
            )

            ids.forEach { render(context, manager, it) }
        }

        private fun render(context: Context, manager: AppWidgetManager, widgetId: Int) {
            val theme = WidgetTheme.resolve(context, CalendarWidgetStore.read(context).theme)

            val widthDp = runCatching { manager.getAppWidgetOptions(widgetId) }
                .getOrNull()
                ?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
                ?.takeIf { it > 0 }
                ?: FALLBACK_WIDTH_DP

            val views = RemoteViews(context.packageName, R.layout.widget_quick_capture)

            views.tint(R.id.widget_background, theme.background, theme)
            views.tint(R.id.capture_icon_background, theme.accent, theme, ACCENT_WASH_ALPHA)
            views.tint(R.id.capture_icon, theme.accent, theme)

            views.setViewVisibility(
                R.id.capture_prompt,
                if (widthDp >= PROMPT_MIN_WIDTH_DP) View.VISIBLE else View.GONE,
            )
            views.setThemedTextColor(R.id.capture_prompt, theme.textDim, theme)

            // The whole widget is the tap target, prompt or not.
            val capture = WidgetIntents.quickAction(
                context,
                widgetId,
                QuickAction.CAPTURE.id,
                lane = 1,
            )
            views.setOnClickPendingIntent(R.id.widget_background, capture)
            views.setOnClickPendingIntent(R.id.capture_row, capture)
            views.setContentDescription(
                R.id.capture_row,
                context.getString(R.string.widget_action_capture),
            )

            runCatching { manager.updateAppWidget(widgetId, views) }
        }
    }
}
