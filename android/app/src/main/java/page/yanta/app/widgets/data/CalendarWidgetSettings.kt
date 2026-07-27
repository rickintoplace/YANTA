package page.yanta.app.widgets.data

import android.content.Context
import androidx.core.content.edit
import java.time.LocalDate

/** The four calendar layouts, mirroring the app's own view switcher. */
enum class CalendarWidgetView(val id: String) {
    MONTH("month"),
    WEEK("week"),
    DAY("day"),
    AGENDA("agenda");

    companion object {
        val DEFAULT = AGENDA

        fun fromId(id: String?): CalendarWidgetView =
            entries.firstOrNull { it.id == id } ?: DEFAULT
    }
}

/**
 * How much a month cell says about its events.
 *
 * [TITLES] is the default and matches the app's mobile month view: as many
 * event titles as fit, with the remainder as dots. [DOTS] trades the text
 * for a calm grid of calendar colours.
 */
enum class MonthDensity(val id: String) {
    TITLES("titles"),
    DOTS("dots");

    companion object {
        val DEFAULT = TITLES

        fun fromId(id: String?): MonthDensity =
            entries.firstOrNull { it.id == id } ?: DEFAULT
    }
}

/**
 * Per-instance widget configuration: which layout it shows, how dense the
 * month grid is and which period it is currently scrolled to.
 *
 * The anchor is a transient navigation position, not a preference — it is
 * cleared whenever the date rolls over so a widget left on last month is
 * showing today again the next morning.
 */
object CalendarWidgetSettings {

    private const val PREFS = "yanta_widgets"
    private const val KEY_VIEW = "calendar_view_"
    private const val KEY_ANCHOR = "calendar_anchor_"
    private const val KEY_MONTH_DENSITY = "calendar_month_density_"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun view(context: Context, widgetId: Int): CalendarWidgetView =
        CalendarWidgetView.fromId(prefs(context).getString(KEY_VIEW + widgetId, null))

    fun setView(context: Context, widgetId: Int, view: CalendarWidgetView) {
        prefs(context).edit {
            putString(KEY_VIEW + widgetId, view.id)
            remove(KEY_ANCHOR + widgetId)
        }
    }

    fun monthDensity(context: Context, widgetId: Int): MonthDensity =
        MonthDensity.fromId(prefs(context).getString(KEY_MONTH_DENSITY + widgetId, null))

    fun setMonthDensity(context: Context, widgetId: Int, density: MonthDensity) {
        prefs(context).edit { putString(KEY_MONTH_DENSITY + widgetId, density.id) }
    }

    /** The period the widget currently shows, defaulting to today. */
    fun anchor(context: Context, widgetId: Int): LocalDate {
        val stored = prefs(context).getLong(KEY_ANCHOR + widgetId, NO_ANCHOR)

        return if (stored == NO_ANCHOR) {
            LocalDate.now()
        } else {
            runCatching { LocalDate.ofEpochDay(stored) }.getOrDefault(LocalDate.now())
        }
    }

    fun setAnchor(context: Context, widgetId: Int, date: LocalDate?) {
        prefs(context).edit {
            if (date == null || date == LocalDate.now()) {
                remove(KEY_ANCHOR + widgetId)
            } else {
                putLong(KEY_ANCHOR + widgetId, date.toEpochDay())
            }
        }
    }

    /** Called on date/timezone changes so every widget snaps back to today. */
    fun clearAnchors(context: Context, widgetIds: IntArray) {
        prefs(context).edit {
            widgetIds.forEach { remove(KEY_ANCHOR + it) }
        }
    }

    fun forget(context: Context, widgetIds: IntArray) {
        prefs(context).edit {
            widgetIds.forEach {
                remove(KEY_VIEW + it)
                remove(KEY_ANCHOR + it)
                remove(KEY_MONTH_DENSITY + it)
            }
        }
    }

    private const val NO_ANCHOR = Long.MIN_VALUE
}
