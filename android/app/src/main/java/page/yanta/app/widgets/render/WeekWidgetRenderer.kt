package page.yanta.app.widgets.render

import android.view.View
import android.widget.RemoteViews
import page.yanta.app.R
import page.yanta.app.widgets.data.CalendarWidgetData
import page.yanta.app.widgets.ui.WidgetIntents
import java.time.LocalDate
import java.time.ZoneId

/**
 * Week as seven day columns, the readable counterpart to the app's
 * `timeGridWeek`: RemoteViews cannot position blocks on an hour axis, so
 * each day stacks its timed events in order with the start time on the chip.
 *
 * All-day and multi-day events sit above them in a band of continuous bars,
 * exactly where the app's all-day row is.
 */
object WeekWidgetRenderer {

    private const val COLUMN_CHROME_DP = 44
    private const val CHIP_DP = 27
    private const val DOT_ROW_DP = 8
    private const val MAX_CHIPS = 10
    private const val MAX_LANES = 4

    private const val HEADER_DP = 62

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
                    byDay.values.flatten().distinctBy { it.id }.size,
                ),
                canPage = true,
                previous = weekStart.minusWeeks(1),
                next = weekStart.plusWeeks(1),
                createFor = createTarget(render, weekStart, weekEnd),
            ),
        )

        val available = render.heightDp - COLUMN_CHROME_DP - HEADER_DP
        val maxLanes = (available / (SpanLanes.LANE_DP * 2)).coerceIn(0, MAX_LANES)

        val spans = SpanLanes.build(render, weekStart, byDay, maxLanes, zone)
        val capacity = capacity(available, spans.lanes.size)

        views.removeAllViews(R.id.week_body)
        views.addView(
            R.id.week_body,
            WeekBand.assemble(
                render = render,
                days = WeekBand.daysOf(weekStart),
                lanes = spans.lanes,
                dayHeader = { dayHeader(render, it) },
                fillDayChips = { day, column ->
                    EventStack.fillTimed(
                        container = column,
                        containerId = R.id.day_chips,
                        render = render,
                        events = spans.perDay[day].orEmpty(),
                        capacity = capacity,
                        zone = zone,
                    )

                    column.setOnClickPendingIntent(
                        R.id.day_chips,
                        WidgetIntents.openDay(render.context, render.widgetId, day),
                    )
                },
            ),
        )

        return views
    }

    private fun dayHeader(render: WidgetRenderContext, day: LocalDate): RemoteViews {
        val theme = render.theme
        val header = RemoteViews(render.context.packageName, R.layout.widget_week_day_header)

        val isToday = day == render.today
        val isPast = day.isBefore(render.today)

        header.setTextViewText(R.id.day_weekday, render.format.weekdayNarrow(day.dayOfWeek))
        header.setThemedTextColor(R.id.day_weekday, theme.textFaint, theme)

        header.setTextViewText(R.id.day_number, day.dayOfMonth.toString())

        if (isToday) {
            header.setTextColor(R.id.day_number, theme.onAccent)
        } else {
            header.setThemedTextColor(
                R.id.day_number,
                if (isPast) theme.textFaint else theme.text,
                theme,
            )
        }

        header.setViewVisibility(R.id.day_marker, if (isToday) View.VISIBLE else View.GONE)
        if (isToday) header.tint(R.id.day_marker, theme.accent, theme)

        header.setOnClickPendingIntent(
            R.id.day_root,
            WidgetIntents.openDay(render.context, render.widgetId, day),
        )

        return header
    }

    private fun capacity(available: Int, lanes: Int): EventStack.Capacity {
        val forChips = available - lanes * SpanLanes.LANE_DP

        return EventStack.Capacity(
            chips = (forChips / CHIP_DP).coerceIn(1, MAX_CHIPS),
            chipsBesideDots = ((forChips - DOT_ROW_DP) / CHIP_DP).coerceIn(1, MAX_CHIPS),
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
}
