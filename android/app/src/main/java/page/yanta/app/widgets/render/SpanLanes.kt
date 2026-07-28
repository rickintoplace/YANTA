package page.yanta.app.widgets.render

import android.view.View
import android.widget.RemoteViews
import page.yanta.app.R
import page.yanta.app.widgets.data.WidgetEvent
import page.yanta.app.widgets.ui.WidgetIntents
import java.time.LocalDate
import java.time.ZoneId

/**
 * The all-day band of a calendar week: continuous bars for events that cover
 * whole days, laid out across the week's seven columns.
 *
 * A bar spanning Monday to Friday cannot live inside a day cell, so the band
 * is a sibling of the day row rather than part of it — the same structure
 * FullCalendar gives the app. One event is one bar, which is both what the
 * user reads as a single event and what buys the title five columns of width
 * instead of one.
 *
 * RemoteViews cannot set `layout_weight` at runtime, so each width is a
 * pre-declared wrapper (`widget_span_1` … `widget_span_7`) around one shared
 * body. Lanes are capped because each one costs vertical room the day chips
 * would otherwise use; what does not fit falls back to per-day chips.
 */
object SpanLanes {

    /** Height one lane occupies, for the callers' capacity arithmetic. */
    const val LANE_DP = 16

    private const val COLUMNS = 7

    private val WIDTH_LAYOUTS = intArrayOf(
        R.layout.widget_span_1,
        R.layout.widget_span_2,
        R.layout.widget_span_3,
        R.layout.widget_span_4,
        R.layout.widget_span_5,
        R.layout.widget_span_6,
        R.layout.widget_span_7,
    )

    /** An event placed on the week's grid, clipped to the visible columns. */
    private data class Placed(
        val event: WidgetEvent,
        val firstColumn: Int,
        val lastColumn: Int,
        val continuesBefore: Boolean,
        val continuesAfter: Boolean,
    ) {
        val width: Int get() = lastColumn - firstColumn + 1

        fun overlaps(other: Placed): Boolean =
            firstColumn <= other.lastColumn && other.firstColumn <= lastColumn
    }

    /**
     * What a week's events become once the band has taken its share.
     *
     * [lanes] are ready to add to a vertical container; [perDay] holds what
     * each column still renders itself — timed events, plus any span that did
     * not fit the lane budget.
     */
    data class Result(
        val lanes: List<RemoteViews>,
        val perDay: Map<LocalDate, List<WidgetEvent>>,
    )

    fun build(
        render: WidgetRenderContext,
        weekStart: LocalDate,
        byDay: Map<LocalDate, List<WidgetEvent>>,
        maxLanes: Int,
        zone: ZoneId,
    ): Result {
        val days = (0 until COLUMNS).map { weekStart.plusDays(it.toLong()) }

        val banded = days
            .flatMap { byDay[it].orEmpty() }
            .distinctBy { it.id }
            .filter { it.isBanded(zone) }
            .sortedWith(
                // Earliest first, longest first: the bars that carry the most
                // meaning get the top lanes and stay stable while paging.
                compareBy<WidgetEvent> { it.startDate(zone) }
                    .thenByDescending { it.dayCount(zone) }
                    .thenBy { it.title }
            )
            .map { place(it, weekStart, zone) }

        val lanes = mutableListOf<MutableList<Placed>>()
        val overflow = mutableSetOf<String>()

        for (span in banded) {
            val lane = lanes.firstOrNull { occupants -> occupants.none { it.overlaps(span) } }
                ?: mutableListOf<Placed>().takeIf { lanes.size < maxLanes }?.also { lanes += it }

            if (lane == null) overflow += span.event.id else lane += span
        }

        val perDay = days.associateWith { day ->
            byDay[day].orEmpty().filter { !it.isBanded(zone) || it.id in overflow }
        }

        return Result(
            lanes = lanes.map { laneViews(render, weekStart, it) },
            perDay = perDay,
        )
    }

    private fun place(event: WidgetEvent, weekStart: LocalDate, zone: ZoneId): Placed {
        val weekEnd = weekStart.plusDays((COLUMNS - 1).toLong())
        val start = event.startDate(zone)
        val end = event.endDateInclusive(zone)

        return Placed(
            event = event,
            firstColumn = columnOf(maxOf(start, weekStart), weekStart),
            lastColumn = columnOf(minOf(end, weekEnd), weekStart),
            continuesBefore = start.isBefore(weekStart),
            continuesAfter = end.isAfter(weekEnd),
        )
    }

    private fun columnOf(day: LocalDate, weekStart: LocalDate): Int =
        (day.toEpochDay() - weekStart.toEpochDay()).toInt().coerceIn(0, COLUMNS - 1)

    private fun laneViews(
        render: WidgetRenderContext,
        weekStart: LocalDate,
        placed: List<Placed>,
    ): RemoteViews {
        val lane = RemoteViews(render.context.packageName, R.layout.widget_span_lane)

        var column = 0
        placed.sortedBy { it.firstColumn }.forEach { span ->
            if (span.firstColumn > column) {
                lane.addView(R.id.span_lane, spacer(render, span.firstColumn - column))
            }

            lane.addView(R.id.span_lane, bar(render, weekStart, span))
            column = span.lastColumn + 1
        }

        if (column < COLUMNS) {
            lane.addView(R.id.span_lane, spacer(render, COLUMNS - column))
        }

        return lane
    }

    private fun spacer(render: WidgetRenderContext, width: Int): RemoteViews =
        segment(render, width).apply {
            setViewVisibility(R.id.span_background, View.INVISIBLE)
            setViewVisibility(R.id.span_title, View.INVISIBLE)
        }

    private fun bar(
        render: WidgetRenderContext,
        weekStart: LocalDate,
        span: Placed,
    ): RemoteViews {
        val event = span.event
        val views = segment(render, span.width)

        views.setImageViewResource(
            R.id.span_background,
            when {
                span.continuesBefore && span.continuesAfter -> R.drawable.widget_shape_span_middle
                span.continuesBefore -> R.drawable.widget_shape_span_end
                span.continuesAfter -> R.drawable.widget_shape_span_start
                else -> R.drawable.widget_shape_rounded_sm
            },
        )
        views.tint(R.id.span_background, event.color)

        views.setTextViewText(R.id.span_title, event.title)
        views.setTextColor(R.id.span_title, render.theme.readableTextOn(event.color))
        views.setContentDescription(R.id.span_root, event.title)

        views.setOnClickPendingIntent(
            R.id.span_root,
            if (event.editable) {
                WidgetIntents.openEvent(render.context, render.widgetId, event.id)
            } else {
                WidgetIntents.openDay(
                    render.context,
                    render.widgetId,
                    weekStart.plusDays(span.firstColumn.toLong()),
                )
            },
        )

        return views
    }

    private fun segment(render: WidgetRenderContext, width: Int): RemoteViews =
        RemoteViews(
            render.context.packageName,
            WIDTH_LAYOUTS[width.coerceIn(1, COLUMNS) - 1],
        )
}
