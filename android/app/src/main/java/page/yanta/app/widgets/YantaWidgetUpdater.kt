package page.yanta.app.widgets

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import org.json.JSONObject
import page.yanta.app.widgets.data.CalendarWidgetStore

/**
 * Everything the rest of the app needs to know about home-screen widgets.
 *
 * The `request*` entry points are for callers on someone else's thread —
 * the JS bridge above all — and hand the work to [WidgetWork]. The plain
 * ones render immediately and are meant for code already running there.
 */
object YantaWidgetUpdater {

    /** Redraws every placed widget. Must run off the main thread. */
    fun updateAll(context: Context) {
        CalendarWidgetProvider.updateAll(context)
        QuickCreateWidgetProvider.updateAll(context)
        QuickCaptureWidgetProvider.updateAll(context)
        WidgetRefreshReceiver.scheduleMidnightRefresh(context)
    }

    fun requestUpdate(context: Context) {
        val app = context.applicationContext

        WidgetWork.execute { updateAll(app) }
    }

    /** Stores a freshly synced calendar payload and repaints the widgets. */
    fun requestCalendarDataSync(context: Context, json: String) {
        val app = context.applicationContext

        WidgetWork.execute {
            CalendarWidgetStore.write(app, json)
            CalendarWidgetProvider.updateAll(app)
            WidgetRefreshReceiver.scheduleMidnightRefresh(app)
        }
    }

    /**
     * How many widgets of each kind are placed, so the web layer can skip
     * building a payload nothing would render.
     */
    fun stateJson(context: Context): String {
        val manager = AppWidgetManager.getInstance(context)

        return JSONObject()
            .put("calendar", count(context, manager, CalendarWidgetProvider::class.java))
            .put("quickCreate", count(context, manager, QuickCreateWidgetProvider::class.java))
            .put("quickCapture", count(context, manager, QuickCaptureWidgetProvider::class.java))
            .toString()
    }

    private fun count(context: Context, manager: AppWidgetManager, provider: Class<*>): Int =
        runCatching {
            manager.getAppWidgetIds(ComponentName(context, provider)).size
        }.getOrDefault(0)
}
