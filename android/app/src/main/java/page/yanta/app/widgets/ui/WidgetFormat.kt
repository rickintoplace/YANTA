package page.yanta.app.widgets.ui

import page.yanta.app.widgets.data.CalendarWidgetData
import page.yanta.app.widgets.data.WidgetEvent
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.WeekFields
import java.util.Locale

/**
 * Date and time strings for the widgets, using the locale, clock and week
 * start the user configured in the app's calendar preferences.
 */
class WidgetFormat(
    private val locale: Locale,
    private val zone: ZoneId,
    use24HourClock: Boolean,
    weekStart: Int,
) {

    /** Sunday is 7 in java.time but 0 in the web layer's preference. */
    val firstDayOfWeek: DayOfWeek = DayOfWeek.of(if (weekStart == 0) 7 else weekStart)

    private val time = DateTimeFormatter
        .ofPattern(if (use24HourClock) "HH:mm" else "h:mm a", locale)
        .withZone(zone)

    private val timeCompact = DateTimeFormatter
        .ofPattern(if (use24HourClock) "HH:mm" else "h a", locale)
        .withZone(zone)

    private val monthTitle = DateTimeFormatter.ofPattern("LLLL yyyy", locale)
    private val dayTitle = DateTimeFormatter.ofPattern("EEEE, d MMMM", locale)
    private val dayShort = DateTimeFormatter.ofPattern("EEE, d MMM", locale)
    private val monthDay = DateTimeFormatter.ofPattern("d MMM", locale)

    fun time(millis: Long): String = time.format(Instant.ofEpochMilli(millis))

    /** Drops ":00" so a dense grid reads "14" instead of "14:00". */
    fun timeCompact(millis: Long): String {
        val instant = Instant.ofEpochMilli(millis)
        val minute = instant.atZone(zone).minute

        return if (minute == 0) timeCompact.format(instant) else time.format(instant)
    }

    fun monthTitle(date: LocalDate): String = monthTitle.format(date).replaceFirstChar {
        it.titlecase(locale)
    }

    fun dayTitle(date: LocalDate): String = dayTitle.format(date).replaceFirstChar {
        it.titlecase(locale)
    }

    fun dayShort(date: LocalDate): String = dayShort.format(date)

    fun weekTitle(start: LocalDate): String {
        val end = start.plusDays(6)

        return when {
            start.year != end.year -> "${dayShort.format(start)} – ${dayShort.format(end)}"
            start.month != end.month -> "${monthDay.format(start)} – ${monthDay.format(end)} ${end.year}"
            else -> "${start.dayOfMonth}–${end.dayOfMonth} ${monthTitle(start)}"
        }
    }

    fun weekdayNarrow(day: DayOfWeek): String =
        day.getDisplayName(TextStyle.NARROW, locale).uppercase(locale)

    fun weekdayShort(day: DayOfWeek): String =
        day.getDisplayName(TextStyle.SHORT, locale).uppercase(locale)

    /** Monday-first or Sunday-first ordering, per the user's preference. */
    fun weekdays(): List<DayOfWeek> =
        (0..6).map { firstDayOfWeek.plus(it.toLong()) }

    /** First visible day of the week [date] falls into. */
    fun startOfWeek(date: LocalDate): LocalDate =
        date.with(WeekFields.of(firstDayOfWeek, 4).dayOfWeek(), 1)

    /**
     * "09:00", "09:00 – 10:30" or "All day", depending on what the event is
     * and how much room the caller has.
     */
    fun eventTime(event: WidgetEvent, withEnd: Boolean = false): String = when {
        event.allDay -> ALL_DAY
        withEnd && event.endMs > event.startMs -> "${time(event.startMs)} – ${time(event.endMs)}"
        else -> time(event.startMs)
    }

    companion object {
        const val ALL_DAY = "All day"

        fun of(data: CalendarWidgetData, zone: ZoneId = ZoneId.systemDefault()) =
            WidgetFormat(
                locale = data.locale,
                zone = zone,
                use24HourClock = data.use24HourClock,
                weekStart = data.weekStart,
            )
    }
}
