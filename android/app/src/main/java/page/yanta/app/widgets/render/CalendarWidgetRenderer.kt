package page.yanta.app.widgets.render

import android.appwidget.AppWidgetManager
import android.content.Context
import android.os.Bundle
import android.widget.RemoteViews
import page.yanta.app.widgets.data.CalendarWidgetSettings
import page.yanta.app.widgets.data.CalendarWidgetStore
import page.yanta.app.widgets.data.CalendarWidgetView
import page.yanta.app.widgets.ui.WidgetFormat
import page.yanta.app.widgets.ui.WidgetTheme
import java.time.LocalDate
import java.time.ZoneId

/**
 * Builds the RemoteViews for one calendar widget instance: reads its data,
 * configuration and current size, then hands off to the renderer for the
 * selected layout.
 */
object CalendarWidgetRenderer {

    fun build(
        context: Context,
        manager: AppWidgetManager,
        widgetId: Int,
    ): RemoteViews {
        val data = CalendarWidgetStore.read(context)
        val view = CalendarWidgetSettings.view(context, widgetId)
        val zone = ZoneId.systemDefault()

        val options = runCatching { manager.getAppWidgetOptions(widgetId) }.getOrNull()

        val render = WidgetRenderContext(
            context = context,
            widgetId = widgetId,
            theme = WidgetTheme.resolve(context, data.theme),
            format = WidgetFormat.of(data, zone),
            anchor = CalendarWidgetSettings.anchor(context, widgetId),
            today = LocalDate.now(zone),
            monthDensity = CalendarWidgetSettings.monthDensity(context, widgetId),
            widthDp = options.dimension(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, FALLBACK_WIDTH_DP),
            heightDp = options.dimension(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, FALLBACK_HEIGHT_DP),
            hasData = CalendarWidgetStore.hasData(context),
        )

        return when (view) {
            CalendarWidgetView.MONTH -> MonthWidgetRenderer.render(render, data, zone)
            CalendarWidgetView.WEEK -> WeekWidgetRenderer.render(render, data, zone)
            CalendarWidgetView.DAY,
            CalendarWidgetView.AGENDA -> ListWidgetRenderer.render(render, data, view, zone)
        }
    }

    private fun Bundle?.dimension(key: String, fallback: Int): Int =
        this?.getInt(key, 0)?.takeIf { it > 0 } ?: fallback

    // Matches the default 4x3 cell footprint declared in calendar_widget_info.
    private const val FALLBACK_WIDTH_DP = 250
    private const val FALLBACK_HEIGHT_DP = 200
}
