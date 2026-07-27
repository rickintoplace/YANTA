package page.yanta.app.widgets.data

import android.content.Context
import android.graphics.Color
import androidx.core.graphics.toColorInt
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/**
 * One calendar entry as the widgets draw it.
 *
 * Times are epoch millis; [endMs] is exclusive, matching how the web layer
 * hands over all-day spans. Colors arrive already resolved so no widget has
 * to know about categories, linked notes or theme tokens.
 */
data class WidgetEvent(
    val id: String,
    val title: String,
    val startMs: Long,
    val endMs: Long,
    val allDay: Boolean,
    val color: Int,
    val textColor: Int,
    val location: String,
    val editable: Boolean,
) {
    fun startDate(zone: ZoneId): LocalDate =
        Instant.ofEpochMilli(startMs).atZone(zone).toLocalDate()

    /**
     * Last day the event still occupies. The exclusive end means an event
     * finishing at midnight belongs to the previous day, and a zero-length
     * all-day event still covers its start day.
     */
    fun endDateInclusive(zone: ZoneId): LocalDate {
        val end = Instant.ofEpochMilli(endMs).atZone(zone)
        val startDate = startDate(zone)

        if (endMs <= startMs) return startDate

        val candidate = if (end.toLocalTime().toSecondOfDay() == 0) {
            end.toLocalDate().minusDays(1)
        } else {
            end.toLocalDate()
        }

        return if (candidate.isBefore(startDate)) startDate else candidate
    }

    fun coversDay(day: LocalDate, zone: ZoneId): Boolean =
        !day.isBefore(startDate(zone)) && !day.isAfter(endDateInclusive(zone))

    /** Multi-day events render as bars, not as a single timed entry. */
    fun spansMultipleDays(zone: ZoneId): Boolean =
        startDate(zone) != endDateInclusive(zone)
}

/**
 * The payload the web layer pushes for the home-screen widgets, including
 * the calendar display preferences the widgets have to honour.
 */
data class CalendarWidgetData(
    val updatedAt: Long,
    val theme: String,
    val weekStart: Int,
    val use24HourClock: Boolean,
    val locale: Locale,
    val events: List<WidgetEvent>,
) {
    val isEmpty: Boolean get() = events.isEmpty()

    /** Events touching [day], all-day and multi-day ones first. */
    fun eventsOn(day: LocalDate, zone: ZoneId): List<WidgetEvent> =
        events
            .filter { it.coversDay(day, zone) }
            .sortedWith(
                compareByDescending<WidgetEvent> { it.allDay || it.spansMultipleDays(zone) }
                    .thenBy { it.startMs }
                    .thenBy { it.title }
            )

    /**
     * Events bucketed per day across [from] until (exclusive) [to].
     *
     * Grids ask for up to 42 days at once; bucketing once keeps that a
     * single pass over the event list instead of one pass per cell.
     */
    fun eventsByDay(
        from: LocalDate,
        to: LocalDate,
        zone: ZoneId,
    ): Map<LocalDate, List<WidgetEvent>> {
        val buckets = HashMap<LocalDate, MutableList<WidgetEvent>>()

        for (event in events) {
            var day = maxOf(event.startDate(zone), from)
            val last = minOf(event.endDateInclusive(zone), to.minusDays(1))

            while (!day.isAfter(last)) {
                buckets.getOrPut(day) { mutableListOf() }.add(event)
                day = day.plusDays(1)
            }
        }

        val order = compareByDescending<WidgetEvent> { it.allDay || it.spansMultipleDays(zone) }
            .thenBy { it.startMs }
            .thenBy { it.title }

        return buckets.mapValues { (_, list) -> list.sortedWith(order) }
    }

    /** Timed events from [from] onwards, for the agenda view. */
    fun eventsFrom(from: LocalDate, zone: ZoneId, days: Int): List<WidgetEvent> {
        val until = from.plusDays(days.toLong())

        return events
            .filter { it.endDateInclusive(zone) >= from && it.startDate(zone) < until }
            .sortedWith(compareBy({ it.startMs }, { it.title }))
    }

    companion object {
        /*
          A property, not a constant: the device locale can change while the
          process lives, and a cached default would outlive it.
        */
        val EMPTY: CalendarWidgetData
            get() = CalendarWidgetData(
                updatedAt = 0L,
                theme = "auto",
                weekStart = 1,
                use24HourClock = true,
                locale = Locale.getDefault(),
                events = emptyList(),
            )

        fun parse(json: String): CalendarWidgetData {
            val root = runCatching { JSONObject(json) }.getOrNull() ?: return EMPTY
            val rawEvents = root.optJSONArray("events") ?: JSONArray()

            val events = ArrayList<WidgetEvent>(rawEvents.length())
            for (i in 0 until rawEvents.length()) {
                parseEvent(rawEvents.optJSONObject(i))?.let(events::add)
            }

            return CalendarWidgetData(
                updatedAt = root.optLong("updatedAt", 0L),
                theme = root.optString("theme", "auto"),
                weekStart = root.optInt("weekStart", 1).coerceIn(0, 6),
                use24HourClock = root.optString("timeFormat", "24") != "12",
                locale = parseLocale(root.optString("locale", "")),
                events = events,
            )
        }

        private fun parseEvent(obj: JSONObject?): WidgetEvent? {
            if (obj == null) return null

            val id = obj.optString("id")
            val startMs = obj.optLong("start", 0L)
            if (id.isBlank() || startMs <= 0L) return null

            val color = parseColor(obj.optString("color"), FALLBACK_COLOR)

            return WidgetEvent(
                id = id,
                title = obj.optString("title").ifBlank { "Untitled event" },
                startMs = startMs,
                endMs = obj.optLong("end", 0L).takeIf { it > startMs } ?: startMs,
                allDay = obj.optBoolean("allDay", false),
                color = color,
                textColor = parseColor(obj.optString("textColor"), Color.WHITE),
                location = obj.optString("location"),
                editable = obj.optBoolean("editable", false),
            )
        }

        private fun parseColor(value: String?, fallback: Int): Int =
            runCatching { value?.trim().orEmpty().toColorInt() }.getOrDefault(fallback)

        private fun parseLocale(tag: String): Locale =
            tag.trim()
                .takeIf { it.isNotEmpty() }
                ?.let { runCatching { Locale.forLanguageTag(it) }.getOrNull() }
                ?.takeIf { it.language.isNotEmpty() }
                ?: Locale.getDefault()

        private const val FALLBACK_COLOR = 0xFF6EA8FE.toInt()
    }
}

/**
 * File-backed store for the widget calendar payload.
 *
 * A file rather than SharedPreferences: the payload holds a year of
 * expanded events, while the preference-backed notification snapshot is
 * re-read on every sync and must stay small. Parsed results are cached in
 * memory and invalidated by the file's modification time, so the many
 * redraws of a single update parse the JSON exactly once.
 */
object CalendarWidgetStore {

    private const val FILE_NAME = "calendar_widget.json"

    private val lock = Any()

    @Volatile
    private var cached: CalendarWidgetData? = null

    @Volatile
    private var cachedStamp = 0L

    fun write(context: Context, json: String) {
        synchronized(lock) {
            runCatching {
                file(context).writeText(json)
            }.onFailure {
                return@synchronized
            }

            cached = null
            cachedStamp = 0L
        }
    }

    fun read(context: Context): CalendarWidgetData {
        val file = file(context)
        if (!file.exists()) return CalendarWidgetData.EMPTY

        val stamp = file.lastModified()
        cached?.let { if (stamp == cachedStamp) return it }

        return synchronized(lock) {
            cached?.let { if (stamp == cachedStamp) return@synchronized it }

            val parsed = runCatching { CalendarWidgetData.parse(file.readText()) }
                .getOrDefault(CalendarWidgetData.EMPTY)

            cached = parsed
            cachedStamp = stamp
            parsed
        }
    }

    /** True once the app has pushed data at least once. */
    fun hasData(context: Context): Boolean = file(context).exists()

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)
}
