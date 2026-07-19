package page.yanta.app.widgets

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context

object YantaWidgetUpdater {
    fun updateAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context)

        manager.notifyAppWidgetViewDataChanged(
            manager.getAppWidgetIds(ComponentName(context, CalendarWidgetProvider::class.java)),
            page.yanta.app.R.id.calendar_widget_list
        )

        CalendarWidgetProvider.updateAll(context)
        QuickCreateWidgetProvider.updateAll(context)
    }
}