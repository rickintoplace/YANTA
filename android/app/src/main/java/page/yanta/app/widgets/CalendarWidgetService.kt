package page.yanta.app.widgets

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import page.yanta.app.R
import page.yanta.app.widgets.data.CalendarWidgetSettings
import page.yanta.app.widgets.data.CalendarWidgetStore
import page.yanta.app.widgets.data.CalendarWidgetView
import page.yanta.app.widgets.data.WidgetEvent
import page.yanta.app.widgets.render.ListWidgetRenderer
import page.yanta.app.widgets.render.setThemedTextColor
import page.yanta.app.widgets.render.tint
import page.yanta.app.widgets.ui.WidgetFormat
import page.yanta.app.widgets.ui.WidgetIntents
import page.yanta.app.widgets.ui.WidgetTheme
import java.time.LocalDate
import java.time.ZoneId

/** Row source for the day and agenda layouts. */
class CalendarWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        CalendarRowFactory(
            applicationContext,
            intent.getIntExtra(
                AppWidgetManager.EXTRA_APPWIDGET_ID,
                AppWidgetManager.INVALID_APPWIDGET_ID,
            ),
        )
}

/**
 * Turns the widget's period into a flat row list.
 *
 * The day view is a plain timeline; the agenda groups by day with a header
 * row in between, the same structure as the app's list view. Everything
 * runs on the framework's collection thread, so parsing and bucketing the
 * event data here never blocks a widget update.
 */
private class CalendarRowFactory(
    private val context: Context,
    private val widgetId: Int,
) : RemoteViewsService.RemoteViewsFactory {

    private sealed interface Row {
        data class Header(val date: LocalDate, val isToday: Boolean) : Row
        data class Event(val event: WidgetEvent, val date: LocalDate) : Row
    }

    private val zone: ZoneId = ZoneId.systemDefault()

    private var rows: List<Row> = emptyList()
    private var theme: WidgetTheme = WidgetTheme.resolve(context, "auto")
    private var format: WidgetFormat = WidgetFormat.of(CalendarWidgetStore.read(context), zone)

    override fun onCreate() = Unit

    override fun onDataSetChanged() {
        val data = CalendarWidgetStore.read(context)
        val anchor = CalendarWidgetSettings.anchor(context, widgetId)

        theme = WidgetTheme.resolve(context, data.theme)
        format = WidgetFormat.of(data, zone)

        rows = when (CalendarWidgetSettings.view(context, widgetId)) {
            CalendarWidgetView.DAY ->
                data.eventsOn(anchor, zone).map { Row.Event(it, anchor) }

            else -> {
                val today = LocalDate.now(zone)

                /*
                  Bucketed by every day an event covers, not by its start day:
                  a five-day trip has to appear under all five headings, or the
                  four days in between look empty. Row.Event carries the day it
                  is listed under, which is what the "(2/5)" counter needs.
                */
                data.eventsByDay(anchor, anchor.plusDays(ListWidgetRenderer.AGENDA_DAYS.toLong()), zone)
                    .toSortedMap()
                    .flatMap { (date, events) ->
                        buildList {
                            add(Row.Header(date, date == today))
                            events.forEach { add(Row.Event(it, date)) }
                        }
                    }
            }
        }
    }

    override fun onDestroy() {
        rows = emptyList()
    }

    override fun getCount(): Int = rows.size

    override fun getViewAt(position: Int): RemoteViews =
        when (val row = rows.getOrNull(position)) {
            is Row.Header -> headerRow(row)
            is Row.Event -> eventRow(row)
            null -> RemoteViews(context.packageName, R.layout.widget_row_day_header)
        }

    private fun headerRow(row: Row.Header): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_row_day_header)

        views.setTextViewText(
            R.id.header_label,
            if (row.isToday) {
                context.getString(R.string.widget_today_prefix, format.dayShort(row.date))
            } else {
                format.dayShort(row.date)
            },
        )
        views.setThemedTextColor(
            R.id.header_label,
            if (row.isToday) theme.accent else theme.textDim,
            theme,
        )

        views.tint(R.id.header_rule, theme.border, theme)

        views.setOnClickFillInIntent(
            R.id.row_root,
            WidgetIntents.eventFillIn(eventId = "", editable = false, date = row.date),
        )

        return views
    }

    private fun eventRow(row: Row.Event): RemoteViews {
        val event = row.event
        val views = RemoteViews(context.packageName, R.layout.widget_row_event)

        val dayCount = event.dayCount(zone)
        val dayIndex = event.dayIndex(row.date, zone)

        /*
          A timed event crossing midnight starts on its first day and ends on
          its last; the days in between it simply fills. The counter next to
          the title says which of those this row is.
        */
        val timeless = event.allDay ||
            (dayCount > 1 && dayIndex > 1 && dayIndex < dayCount)

        val startsToday = dayIndex == 1
        val timeLabel = when {
            timeless -> WidgetFormat.ALL_DAY
            startsToday -> format.time(event.startMs)
            else -> format.time(event.endMs)
        }

        views.setTextViewText(R.id.row_time_start, timeLabel)
        views.setThemedTextColor(
            R.id.row_time_start,
            if (timeless) theme.textFaint else theme.text,
            theme,
        )

        val showEnd = dayCount == 1 && !event.allDay && event.endMs > event.startMs
        views.setViewVisibility(R.id.row_time_end, if (showEnd) View.VISIBLE else View.GONE)
        if (showEnd) {
            views.setTextViewText(R.id.row_time_end, format.time(event.endMs))
            views.setThemedTextColor(R.id.row_time_end, theme.textFaint, theme)
        }

        views.setViewVisibility(R.id.row_span, if (dayCount > 1) View.VISIBLE else View.GONE)
        if (dayCount > 1) {
            views.setTextViewText(
                R.id.row_span,
                context.getString(R.string.widget_span_position, dayIndex, dayCount),
            )
            views.setThemedTextColor(R.id.row_span, theme.textFaint, theme)
        }

        views.tint(R.id.row_bar, event.color)

        views.setTextViewText(R.id.row_title, event.title)
        views.setThemedTextColor(R.id.row_title, theme.text, theme)

        views.setViewVisibility(
            R.id.row_location,
            if (event.location.isBlank()) View.GONE else View.VISIBLE,
        )
        if (event.location.isNotBlank()) {
            views.setTextViewText(R.id.row_location, event.location)
            views.setThemedTextColor(R.id.row_location, theme.textDim, theme)
        }

        views.setOnClickFillInIntent(
            R.id.row_root,
            WidgetIntents.eventFillIn(event.id, event.editable, row.date),
        )

        return views
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount(): Int = 2

    override fun getItemId(position: Int): Long =
        when (val row = rows.getOrNull(position)) {
            is Row.Header -> row.date.toEpochDay()
            is Row.Event -> row.event.id.hashCode().toLong() * 31 + row.date.toEpochDay()
            null -> position.toLong()
        }

    override fun hasStableIds(): Boolean = true
}
