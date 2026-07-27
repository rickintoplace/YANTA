package page.yanta.app.widgets.render

import android.view.View
import android.widget.RemoteViews
import page.yanta.app.R
import page.yanta.app.widgets.data.CalendarWidgetData
import page.yanta.app.widgets.data.MonthDensity
import page.yanta.app.widgets.data.WidgetEvent
import page.yanta.app.widgets.ui.WidgetIntents
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlin.math.ceil

/**
 * Month grid, mirroring the app's `dayGridMonth` view.
 *
 * The grid is sized to the month it shows (four to six week rows) and each
 * cell spends its height on readable event titles, falling back to coloured
 * dots only for the events that do not fit.
 */
object MonthWidgetRenderer {

    private val WEEK_ROW_IDS = intArrayOf(
        R.id.month_week_0,
        R.id.month_week_1,
        R.id.month_week_2,
        R.id.month_week_3,
        R.id.month_week_4,
        R.id.month_week_5,
    )

    private const val MAX_WEEK_ROWS = 6

    // Vertical budget of a cell, in dp, outside the event area.
    private const val CELL_CHROME_DP = 19
    private const val CHIP_DP = 13
    private const val DOT_ROW_DP = 8
    private const val MAX_CHIPS = 8

    fun render(
        render: WidgetRenderContext,
        data: CalendarWidgetData,
        zone: ZoneId,
    ): RemoteViews {
        val context = render.context
        val views = RemoteViews(context.packageName, R.layout.widget_calendar_month)

        WidgetChrome.applyBackground(views, render)

        val month = YearMonth.from(render.anchor)
        val gridStart = render.format.startOfWeek(month.atDay(1))

        /*
          Most months need five rows. Dropping the sixth gives every cell a
          fifth more height, so the grid is sized to the month on screen
          rather than to the worst case.
        */
        val rows = ceil(
            (ChronoUnit.DAYS.between(gridStart, month.atEndOfMonth()) + 1) / 7.0
        ).toInt().coerceIn(4, MAX_WEEK_ROWS)

        val byDay = data.eventsByDay(gridStart, gridStart.plusDays((rows * 7).toLong()), zone)

        WidgetChrome.applyHeader(
            views,
            render,
            WidgetChrome.HeaderConfig(
                title = render.format.monthTitle(render.anchor),
                subtitle = subtitle(render, data, month, zone),
                canPage = true,
                previous = render.anchor.minusMonths(1).withDayOfMonth(1),
                next = render.anchor.plusMonths(1).withDayOfMonth(1),
                createFor = createTarget(render, month),
            ),
        )

        renderWeekdayStrip(views, render)

        val capacity = capacity(render, rows)

        for (row in 0 until MAX_WEEK_ROWS) {
            views.removeAllViews(WEEK_ROW_IDS[row])
            views.setViewVisibility(
                WEEK_ROW_IDS[row],
                if (row < rows) View.VISIBLE else View.GONE,
            )

            if (row >= rows) continue

            for (column in 0 until 7) {
                val day = gridStart.plusDays((row * 7 + column).toLong())

                views.addView(
                    WEEK_ROW_IDS[row],
                    cell(render, day, month, byDay[day].orEmpty(), capacity, zone),
                )
            }
        }

        return views
    }

    private fun renderWeekdayStrip(views: RemoteViews, render: WidgetRenderContext) {
        views.removeAllViews(R.id.month_weekdays)

        render.format.weekdays().forEach { day ->
            val label = RemoteViews(render.context.packageName, R.layout.widget_month_weekday)

            label.setTextViewText(R.id.weekday_label, render.format.weekdayNarrow(day))
            label.setThemedTextColor(R.id.weekday_label, render.theme.textFaint, render.theme)

            views.addView(R.id.month_weekdays, label)
        }
    }

    private fun cell(
        render: WidgetRenderContext,
        day: LocalDate,
        month: YearMonth,
        events: List<WidgetEvent>,
        capacity: EventStack.Capacity,
        zone: ZoneId,
    ): RemoteViews {
        val theme = render.theme
        val cell = RemoteViews(render.context.packageName, R.layout.widget_month_cell)

        val inMonth = YearMonth.from(day) == month
        val isToday = day == render.today

        cell.setTextViewText(R.id.cell_day_number, day.dayOfMonth.toString())
        if (isToday) {
            // Sits on the accent circle, so it is not a themed colour.
            cell.setTextColor(R.id.cell_day_number, theme.onAccent)
        } else {
            cell.setThemedTextColor(
                R.id.cell_day_number,
                if (inMonth) theme.text else theme.textFaint,
                theme,
            )
        }

        cell.setViewVisibility(R.id.cell_marker, if (isToday) View.VISIBLE else View.GONE)
        if (isToday) cell.tint(R.id.cell_marker, theme.accent, theme)

        cell.removeAllViews(R.id.cell_events)

        if (render.monthDensity == MonthDensity.DOTS) {
            EventStack.fillDots(cell, R.id.cell_events, render, events)
        } else {
            EventStack.fillTitles(
                container = cell,
                containerId = R.id.cell_events,
                render = render,
                events = events,
                capacity = capacity,
                zone = zone,
            )
        }

        cell.setOnClickPendingIntent(
            R.id.cell_root,
            WidgetIntents.openDay(render.context, render.widgetId, day),
        )

        return cell
    }

    /**
     * How many event titles a cell can stack at the widget's current size.
     *
     * Measured against the rows the shown month actually needs, so a
     * five-row month spends its extra height on another event title rather
     * than on padding. The second figure applies only to days that overflow
     * into a dot row, which is half a chip tall.
     */
    private fun capacity(render: WidgetRenderContext, rows: Int): EventStack.Capacity {
        val gridHeight = render.heightDp - HEADER_AND_STRIP_DP
        val cellHeight = if (gridHeight > 0) gridHeight / rows else 0
        val forEvents = cellHeight - CELL_CHROME_DP

        /*
          Zero is a real answer. Squeezing a chip into a cell that cannot
          hold one clips its descenders and bleeds over the week below, so
          a cell that small falls back to dots — text only where it reads.
        */
        return EventStack.Capacity(
            chips = (forEvents / CHIP_DP).coerceIn(0, MAX_CHIPS),
            chipsBesideDots = ((forEvents - DOT_ROW_DP) / CHIP_DP).coerceIn(0, MAX_CHIPS),
        )
    }

    /**
     * Adding an event from the month view lands on today when today is on
     * screen, and on the first of the shown month otherwise.
     */
    private fun createTarget(render: WidgetRenderContext, month: YearMonth): LocalDate =
        if (YearMonth.from(render.today) == month) render.today else month.atDay(1)

    private fun subtitle(
        render: WidgetRenderContext,
        data: CalendarWidgetData,
        month: YearMonth,
        zone: ZoneId,
    ): String {
        if (!render.hasData) return render.context.getString(R.string.widget_needs_sync)

        if (YearMonth.from(render.today) == month) {
            return render.context.getString(
                R.string.widget_subtitle_today,
                WidgetChrome.eventCountLabel(render, data.eventsOn(render.today, zone).size),
            )
        }

        val count = data.eventsByDay(month.atDay(1), month.plusMonths(1).atDay(1), zone)
            .values
            .sumOf { it.size }

        return WidgetChrome.eventCountLabel(render, count)
    }

    // Header (~44dp incl. subtitle), weekday strip and the layout padding.
    private const val HEADER_AND_STRIP_DP = 82

}
