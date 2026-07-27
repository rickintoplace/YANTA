package page.yanta.app.widgets.render

import android.view.View
import android.widget.RemoteViews
import page.yanta.app.R
import page.yanta.app.widgets.data.CalendarWidgetData
import page.yanta.app.widgets.data.WidgetEvent
import page.yanta.app.widgets.ui.WidgetIntents
import java.time.LocalDate
import java.time.ZoneId

/**
 * Week as seven day columns, the readable counterpart to the app's
 * `timeGridWeek`: RemoteViews cannot position blocks on an hour axis, so
 * each day stacks its events in order with the start time on the chip.
 */
object WeekWidgetRenderer {

    private const val COLUMN_CHROME_DP = 44
    private const val CHIP_DP = 27
    private const val DOT_ROW_DP = 8
    private const val MAX_CHIPS = 10

    fun render(
        render: WidgetRenderContext,
        data: CalendarWidgetData,
        zone: ZoneId,
    ): RemoteViews {
        val context = render.context
        val views = RemoteViews(context.packageName, R.layout.widget_calendar_week)

        WidgetChrome.applyBackground(views, render)

        val weekStart = render.format.startOfWeek(render.anchor)
        val weekEnd = weekStart.plusWeeks(1)
        val byDay = data.eventsByDay(weekStart, weekEnd, zone)

        WidgetChrome.applyHeader(
            views,
            render,
            WidgetChrome.HeaderConfig(
                title = render.format.weekTitle(weekStart),
                subtitle = WidgetChrome.countSubtitle(
                    render,
                    byDay.values.sumOf { it.size },
                ),
                canPage = true,
                previous = weekStart.minusWeeks(1),
                next = weekStart.plusWeeks(1),
                createFor = createTarget(render, weekStart, weekEnd),
            ),
        )

        val capacity = capacity(render)

        views.removeAllViews(R.id.week_columns)
        for (offset in 0L until 7L) {
            val day = weekStart.plusDays(offset)

            views.addView(
                R.id.week_columns,
                column(render, day, byDay[day].orEmpty(), capacity, zone),
            )
        }

        return views
    }

    private fun column(
        render: WidgetRenderContext,
        day: LocalDate,
        events: List<WidgetEvent>,
        capacity: EventStack.Capacity,
        zone: ZoneId,
    ): RemoteViews {
        val theme = render.theme
        val column = RemoteViews(render.context.packageName, R.layout.widget_week_column)

        val isToday = day == render.today
        val isPast = day.isBefore(render.today)

        column.setTextViewText(R.id.column_weekday, render.format.weekdayNarrow(day.dayOfWeek))
        column.setThemedTextColor(R.id.column_weekday, theme.textFaint, theme)

        column.setTextViewText(R.id.column_day_number, day.dayOfMonth.toString())
        if (isToday) {
            column.setTextColor(R.id.column_day_number, theme.onAccent)
        } else {
            column.setThemedTextColor(
                R.id.column_day_number,
                if (isPast) theme.textFaint else theme.text,
                theme,
            )
        }

        column.setViewVisibility(R.id.column_marker, if (isToday) View.VISIBLE else View.GONE)
        if (isToday) column.tint(R.id.column_marker, theme.accent, theme)

        column.removeAllViews(R.id.column_events)

        EventStack.fillTimed(
            container = column,
            containerId = R.id.column_events,
            render = render,
            events = events,
            capacity = capacity,
            zone = zone,
        )

        column.setOnClickPendingIntent(
            R.id.column_root,
            WidgetIntents.openDay(render.context, render.widgetId, day),
        )

        return column
    }

    private fun capacity(render: WidgetRenderContext): EventStack.Capacity {
        val available = render.heightDp - COLUMN_CHROME_DP - HEADER_DP

        return EventStack.Capacity(
            chips = (available / CHIP_DP).coerceIn(1, MAX_CHIPS),
            chipsBesideDots = ((available - DOT_ROW_DP) / CHIP_DP).coerceIn(1, MAX_CHIPS),
        )
    }

    /** Creating from the week view prefers today when it is in view. */
    private fun createTarget(
        render: WidgetRenderContext,
        weekStart: LocalDate,
        weekEnd: LocalDate,
    ): LocalDate =
        if (!render.today.isBefore(weekStart) && render.today.isBefore(weekEnd)) {
            render.today
        } else {
            weekStart
        }

    private const val HEADER_DP = 62
}
