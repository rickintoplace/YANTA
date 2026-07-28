package page.yanta.app.widgets.render

import android.widget.RemoteViews
import page.yanta.app.R
import java.time.LocalDate

/**
 * Assembles one week of a calendar grid: a row of dates, the all-day band
 * of span bars, then each day's remaining events underneath.
 *
 * The month rows and the week view are the same three-part structure and
 * differ only in what a day's header looks like and how its chips are
 * styled, so those two pieces come from the caller.
 */
object WeekBand {

    const val COLUMNS = 7

    fun daysOf(weekStart: LocalDate): List<LocalDate> =
        (0 until COLUMNS).map { weekStart.plusDays(it.toLong()) }

    fun assemble(
        render: WidgetRenderContext,
        days: List<LocalDate>,
        lanes: List<RemoteViews>,
        dayHeader: (LocalDate) -> RemoteViews,
        fillDayChips: (LocalDate, RemoteViews) -> Unit,
    ): RemoteViews {
        val band = RemoteViews(render.context.packageName, R.layout.widget_week_band)

        band.removeAllViews(R.id.band_days)
        band.removeAllViews(R.id.band_lanes)
        band.removeAllViews(R.id.band_chips)

        days.forEach { band.addView(R.id.band_days, dayHeader(it)) }

        lanes.forEach { band.addView(R.id.band_lanes, it) }

        days.forEach { day ->
            val column = RemoteViews(render.context.packageName, R.layout.widget_day_chips)
            fillDayChips(day, column)
            band.addView(R.id.band_chips, column)
        }

        return band
    }
}
