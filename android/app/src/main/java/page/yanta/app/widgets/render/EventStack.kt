package page.yanta.app.widgets.render

import android.widget.RemoteViews
import page.yanta.app.R
import page.yanta.app.widgets.data.WidgetEvent
import java.time.ZoneId

/**
 * The stack of events inside one month cell or week column.
 *
 * Both grids show as many readable event titles as fit and collapse the
 * remainder into coloured dots, so the packing rule lives here rather than
 * twice. Dots instead of a "+3 more" counter is deliberate: the dot row is
 * half a chip tall, so a busy day spends nearly all of its height on event
 * titles and still shows that more is going on, in the colours of the
 * calendars involved.
 */
object EventStack {

    /**
     * How many chips a cell holds — with and without the dot row, because
     * the row only costs height on the days that actually overflow.
     */
    data class Capacity(val chips: Int, val chipsBesideDots: Int)

    // Dots standing in for hidden events share a row with chips …
    private const val MAX_OVERFLOW_DOTS = 4

    // … while the dots-only month option has the cell to itself.
    private const val MAX_STANDALONE_DOTS = 6

    /** Month cells: title only, matching the app's mobile month view. */
    fun fillTitles(
        container: RemoteViews,
        containerId: Int,
        render: WidgetRenderContext,
        events: List<WidgetEvent>,
        capacity: Capacity,
        zone: ZoneId,
    ) = fill(container, containerId, render, events, capacity) { event ->
        RemoteViews(render.context.packageName, R.layout.widget_month_chip).apply {
            bindEventChip(event, render.theme, zone)
        }
    }

    /** Week columns: the start time sits above the title. */
    fun fillTimed(
        container: RemoteViews,
        containerId: Int,
        render: WidgetRenderContext,
        events: List<WidgetEvent>,
        capacity: Capacity,
        zone: ZoneId,
    ) = fill(container, containerId, render, events, capacity) { event ->
        RemoteViews(render.context.packageName, R.layout.widget_event_chip).apply {
            bindEventChip(event, render.theme, zone)
            bindChipTime(event, render.theme, render.format, zone)
        }
    }

    /** Every event as a coloured dot — the compact month option. */
    fun fillDots(
        container: RemoteViews,
        containerId: Int,
        render: WidgetRenderContext,
        events: List<WidgetEvent>,
    ) {
        if (events.isEmpty()) return

        container.addView(containerId, dotRow(render, events, MAX_STANDALONE_DOTS))
    }

    private inline fun fill(
        container: RemoteViews,
        containerId: Int,
        render: WidgetRenderContext,
        events: List<WidgetEvent>,
        capacity: Capacity,
        chip: (WidgetEvent) -> RemoteViews,
    ) {
        if (events.isEmpty()) return

        val shown = when {
            // Too short for a readable chip: show the day as colours only.
            capacity.chips <= 0 -> 0
            events.size > capacity.chips -> capacity.chipsBesideDots
            else -> events.size
        }

        events.take(shown).forEach { container.addView(containerId, chip(it)) }

        if (events.size > shown) {
            container.addView(
                containerId,
                dotRow(
                    render,
                    events.drop(shown),
                    if (shown == 0) MAX_STANDALONE_DOTS else MAX_OVERFLOW_DOTS,
                ),
            )
        }
    }

    private fun dotRow(
        render: WidgetRenderContext,
        events: List<WidgetEvent>,
        max: Int,
    ): RemoteViews {
        val row = RemoteViews(render.context.packageName, R.layout.widget_month_dots)

        events.take(max).forEach { event ->
            val dot = RemoteViews(render.context.packageName, R.layout.widget_month_dot)
            dot.tint(R.id.dot, event.color)
            row.addView(R.id.dot_row, dot)
        }

        return row
    }
}
