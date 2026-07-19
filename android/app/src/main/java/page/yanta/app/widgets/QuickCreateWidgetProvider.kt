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

class QuickCreateWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { update(context, manager, it) }
    }

    companion object {
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(context, QuickCreateWidgetProvider::class.java)
            )
            ids.forEach { update(context, manager, it) }
        }

        private fun update(context: Context, manager: AppWidgetManager, widgetId: Int) {
            val rv = RemoteViews(context.packageName, R.layout.widget_quick_create)

            fun bind(buttonId: Int, action: String, requestCode: Int) {
                val intent = Intent(context, MainActivity::class.java).apply {
                    this.action = Intent.ACTION_VIEW
                    data = Uri.parse("yanta://open?action=$action")
                }
                rv.setOnClickPendingIntent(
                    buttonId,
                    PendingIntent.getActivity(
                        context,
                        widgetId + requestCode,
                        intent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                )
            }

            bind(R.id.qc_note, "quick_note", 1)
            bind(R.id.qc_folder, "quick_folder", 2)
            bind(R.id.qc_event, "quick_event", 3)
            bind(R.id.qc_sources, "sources", 4)

            manager.updateAppWidget(widgetId, rv)
        }
    }
}