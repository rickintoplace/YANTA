package page.yanta.app.widgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import page.yanta.app.R
import page.yanta.app.widgets.data.CalendarWidgetSettings
import page.yanta.app.widgets.render.CalendarWidgetRenderer
import page.yanta.app.widgets.ui.WidgetIntents
import java.time.LocalDate

/**
 * The YANTA calendar widget.
 *
 * Rendering reads a data file and expands a month grid, so every broadcast
 * is finished asynchronously off the main thread — a widget update must
 * never block the UI of the app it belongs to.
 */
class CalendarWidgetProvider : AppWidgetProvider() {

    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()

        WidgetWork.execute {
            try {
                if (intent.action == WidgetIntents.ACTION_NAVIGATE) {
                    navigate(context, intent)
                } else {
                    // AppWidgetProvider.onReceive only dispatches; safe off the main thread.
                    super.onReceive(context, intent)
                }
            } finally {
                pending.finish()
            }
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { render(context, manager, it) }
    }

    /** Resizing changes how dense a grid may be, so it has to re-render. */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        widgetId: Int,
        newOptions: Bundle?,
    ) {
        render(context, manager, widgetId)
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        CalendarWidgetSettings.forget(context, ids)
    }

    private fun navigate(context: Context, intent: Intent) {
        val widgetId = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        )
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return

        // No extra means "back to today".
        val target = intent
            .takeIf { it.hasExtra(WidgetIntents.EXTRA_ANCHOR_DAY) }
            ?.getLongExtra(WidgetIntents.EXTRA_ANCHOR_DAY, 0L)
            ?.let { runCatching { LocalDate.ofEpochDay(it) }.getOrNull() }

        CalendarWidgetSettings.setAnchor(context, widgetId, target)

        render(context, AppWidgetManager.getInstance(context), widgetId)
    }

    companion object {

        /** Re-renders every placed calendar widget. */
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)

            widgetIds(context, manager).forEach { render(context, manager, it) }
        }

        fun widgetIds(context: Context, manager: AppWidgetManager): IntArray =
            manager.getAppWidgetIds(ComponentName(context, CalendarWidgetProvider::class.java))

        /*
          notifyAppWidgetViewDataChanged(Int, Int) is deprecated in favour of
          RemoteViews.RemoteCollectionItems, which needs API 31; the service-backed
          collection this widget uses is the supported path down to minSdk 29.
        */
        @Suppress("DEPRECATION")
        fun render(context: Context, manager: AppWidgetManager, widgetId: Int) {
            runCatching {
                manager.updateAppWidget(
                    widgetId,
                    CalendarWidgetRenderer.build(context, manager, widgetId),
                )
                // Collection-backed layouts reload their rows separately.
                manager.notifyAppWidgetViewDataChanged(widgetId, R.id.widget_list)
            }
        }
    }
}
