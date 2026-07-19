package page.yanta.app.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import page.yanta.app.MainActivity
import page.yanta.app.R

class CalendarWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { updateWidget(context, manager, it) }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)

        if (intent.action == ACTION_VIEW) {
            val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
            val view = intent.getStringExtra(EXTRA_VIEW) ?: "list"
            if (widgetId != -1) {
                context.getSharedPreferences("yanta_widgets", Context.MODE_PRIVATE)
                    .edit()
                    .putString("calendar_view_$widgetId", view)
                    .apply()
                val manager = AppWidgetManager.getInstance(context)
                manager.notifyAppWidgetViewDataChanged(widgetId, R.id.calendar_widget_list)
                updateWidget(context, manager, widgetId)
            }
        }
    }

    companion object {
        const val ACTION_VIEW = "page.yanta.app.widget.CALENDAR_VIEW"
        const val EXTRA_VIEW = "view"

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(context, CalendarWidgetProvider::class.java)
            )
            ids.forEach { updateWidget(context, manager, it) }
        }

        private fun updateWidget(context: Context, manager: AppWidgetManager, widgetId: Int) {
            val prefs = context.getSharedPreferences("yanta_widgets", Context.MODE_PRIVATE)
            val viewMode = prefs.getString("calendar_view_$widgetId", "list") ?: "list"

            val rv = RemoteViews(context.packageName, R.layout.widget_calendar)

            rv.setTextViewText(R.id.calendar_widget_title, "YANTA Calendar · ${viewMode.replaceFirstChar { it.uppercase() }}")

            val serviceIntent = Intent(context, CalendarWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                putExtra(EXTRA_VIEW, viewMode)
                data = Uri.parse("yanta://calendar-widget/$widgetId/$viewMode")
            }
            rv.setRemoteAdapter(R.id.calendar_widget_list, serviceIntent)
            rv.setEmptyView(R.id.calendar_widget_list, R.id.calendar_widget_empty)

            val openCalendarIntent = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse("https://yanta.page/#calendar")
            }
            rv.setOnClickPendingIntent(
                R.id.calendar_widget_header,
                PendingIntent.getActivity(
                    context,
                    widgetId + 10_000,
                    openCalendarIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )

            fun setViewButton(id: Int, mode: String, request: Int) {
                val intent = Intent(context, CalendarWidgetProvider::class.java).apply {
                    action = ACTION_VIEW
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                    putExtra(EXTRA_VIEW, mode)
                }
                rv.setOnClickPendingIntent(
                    id,
                    PendingIntent.getBroadcast(
                        context,
                        widgetId + request,
                        intent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                )
            }

            setViewButton(R.id.btn_widget_month, "month", 1)
            setViewButton(R.id.btn_widget_week, "week", 2)
            setViewButton(R.id.btn_widget_day, "day", 3)
            setViewButton(R.id.btn_widget_list, "list", 4)

            val templateIntent = Intent(context, MainActivity::class.java)
            val template = PendingIntent.getActivity(
                context,
                50_000 + widgetId,
                templateIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
            rv.setPendingIntentTemplate(R.id.calendar_widget_list, template)

            manager.updateAppWidget(widgetId, rv)
        }
    }
}