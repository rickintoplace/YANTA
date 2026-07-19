package page.yanta.app.widgets

import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONObject
import page.yanta.app.R
import page.yanta.app.data.NativeStore
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class CalendarWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return CalendarFactory(applicationContext, intent.getStringExtra(CalendarWidgetProvider.EXTRA_VIEW) ?: "list")
    }
}

class CalendarFactory(
    private val context: android.content.Context,
    private val viewMode: String
) : RemoteViewsService.RemoteViewsFactory {

    private data class Event(
        val id: String,
        val title: String,
        val startMs: Long,
        val allDay: Boolean
    )

    private var events: List<Event> = emptyList()

    override fun onCreate() {}

    override fun onDataSetChanged() {
        val now = System.currentTimeMillis()
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)

        val root = JSONObject(NativeStore.snapshot(context))
        val arr = root.optJSONArray("calendarEvents")

        val list = mutableListOf<Event>()
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val startIso = obj.optString("start")
                val ms = try { Instant.parse(startIso).toEpochMilli() } catch (_: Throwable) { continue }
                if (ms < now - 86_400_000L) continue

                val date = Instant.ofEpochMilli(ms).atZone(zone).toLocalDate()
                val include = when (viewMode) {
                    "day" -> date == today
                    "week" -> !date.isBefore(today) && date.isBefore(today.plusDays(7))
                    "month" -> date.month == today.month && date.year == today.year
                    else -> true
                }

                if (include) {
                    list.add(
                        Event(
                            id = obj.optString("id"),
                            title = obj.optString("title", "Untitled event"),
                            startMs = ms,
                            allDay = obj.optBoolean("allDay", false)
                        )
                    )
                }
            }
        }

        events = list.sortedBy { it.startMs }.take(50)
    }

    override fun onDestroy() {}

    override fun getCount(): Int = events.size

    override fun getViewAt(position: Int): RemoteViews {
        val event = events[position]
        val rv = RemoteViews(context.packageName, R.layout.widget_calendar_row)

        val fmt = if (event.allDay) {
            DateTimeFormatter.ofPattern("EEE, dd MMM").withZone(ZoneId.systemDefault())
        } else {
            DateTimeFormatter.ofPattern("EEE, dd MMM · HH:mm").withZone(ZoneId.systemDefault())
        }

        rv.setTextViewText(R.id.widget_event_time, fmt.format(Instant.ofEpochMilli(event.startMs)))
        rv.setTextViewText(R.id.widget_event_title, event.title)

        val fillIn = Intent().apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("https://yanta.page/#calendar/${Uri.encode(event.id)}")
        }
        rv.setOnClickFillInIntent(R.id.widget_event_row, fillIn)

        return rv
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = events[position].id.hashCode().toLong()
    override fun hasStableIds(): Boolean = true
}