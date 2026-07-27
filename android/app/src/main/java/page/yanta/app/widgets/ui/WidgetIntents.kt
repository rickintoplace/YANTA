package page.yanta.app.widgets.ui

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.net.toUri
import page.yanta.app.MainActivity
import page.yanta.app.widgets.CalendarWidgetConfigActivity
import page.yanta.app.widgets.CalendarWidgetProvider
import java.time.LocalDate

/**
 * Every tap target a widget offers.
 *
 * App targets go through the `yanta://open` deep link the native layer
 * already routes to the web app; widget-internal navigation goes back to
 * [CalendarWidgetProvider] as a broadcast so paging a month never has to
 * wake the WebView.
 */
object WidgetIntents {

    const val ACTION_NAVIGATE = "page.yanta.app.widget.CALENDAR_NAVIGATE"
    const val EXTRA_ANCHOR_DAY = "anchor_day"

    /*
      Request-code lanes. Two PendingIntents only collide when both the
      request code and the intent match, but keeping the lanes distinct
      makes the widget's tap targets independent by construction.
      Quick-create actions get the tail of the range.
    */
    private const val LANE_OPEN_CALENDAR = 1
    private const val LANE_NAVIGATE = 2
    private const val LANE_CONFIG = 3
    private const val LANE_OPEN_DAY = 4
    private const val LANE_CREATE_EVENT = 5
    private const val LANE_COLLECTION = 6

    private const val REQUEST_LANES = 16

    fun openCalendar(context: Context, widgetId: Int): PendingIntent =
        activity(context, widgetId, LANE_OPEN_CALENDAR, appUri("calendar"))

    fun openDay(context: Context, widgetId: Int, date: LocalDate): PendingIntent =
        activity(context, widgetId, LANE_OPEN_DAY, appUri("calendar-day", "date" to date.toString()))

    fun createEvent(context: Context, widgetId: Int, date: LocalDate): PendingIntent =
        activity(context, widgetId, LANE_CREATE_EVENT, appUri("calendar-new", "date" to date.toString()))

    /**
     * Fill-in intent for a collection item. Collection rows share one
     * template, so only the differing part is built here.
     */
    fun eventFillIn(eventId: String, editable: Boolean, date: LocalDate): Intent =
        Intent().apply {
            action = Intent.ACTION_VIEW
            data = if (editable && eventId.isNotBlank()) {
                appUri("calendar-event", "id" to eventId)
            } else {
                appUri("calendar-day", "date" to date.toString())
            }
        }

    /** Template every collection row's fill-in intent is merged into. */
    fun collectionTemplate(context: Context, widgetId: Int): PendingIntent =
        PendingIntent.getActivity(
            context,
            requestCode(widgetId, LANE_COLLECTION),
            Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )

    fun navigateTo(context: Context, widgetId: Int, date: LocalDate?): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            requestCode(widgetId, LANE_NAVIGATE),
            Intent(context, CalendarWidgetProvider::class.java).apply {
                action = ACTION_NAVIGATE
                // Extras alone never make two PendingIntents distinct.
                data = "yanta-widget://navigate/$widgetId/${date?.toEpochDay() ?: "today"}".toUri()
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                date?.let { putExtra(EXTRA_ANCHOR_DAY, it.toEpochDay()) }
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    fun openViewPicker(context: Context, widgetId: Int): PendingIntent =
        openConfig(context, widgetId, CalendarWidgetConfigActivity::class.java)

    /** Opens a widget's configuration screen from the widget itself. */
    fun openConfig(context: Context, widgetId: Int, activity: Class<*>): PendingIntent =
        PendingIntent.getActivity(
            context,
            requestCode(widgetId, LANE_CONFIG),
            Intent(context, activity).apply {
                action = Intent.ACTION_VIEW
                data = "yanta-widget://configure/$widgetId".toUri()
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    fun quickAction(context: Context, widgetId: Int, action: String, lane: Int): PendingIntent =
        activity(context, widgetId, lane, appUri(action))

    private fun activity(
        context: Context,
        widgetId: Int,
        lane: Int,
        uri: Uri,
    ): PendingIntent = PendingIntent.getActivity(
        context,
        requestCode(widgetId, lane),
        Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = uri
        },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun appUri(action: String, vararg params: Pair<String, String>): Uri =
        Uri.Builder()
            .scheme("yanta")
            .authority("open")
            .appendQueryParameter("action", action)
            .apply { params.forEach { (key, value) -> appendQueryParameter(key, value) } }
            .build()

    private fun requestCode(widgetId: Int, lane: Int) = widgetId * REQUEST_LANES + lane
}
