package page.yanta.app.widgets

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import page.yanta.app.widgets.data.CalendarWidgetSettings
import java.time.LocalDate
import java.time.ZoneId

/**
 * Keeps widgets honest about what "today" is.
 *
 * ACTION_DATE_CHANGED is not delivered to manifest receivers on modern
 * Android, so the date rollover runs on an alarm that reschedules itself.
 * Time, timezone and locale changes still arrive as broadcasts and are
 * handled here too, as are reboots and app updates, after which no widget
 * has been drawn yet.
 */
class WidgetRefreshReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()

        WidgetWork.execute {
            try {
                val manager = AppWidgetManager.getInstance(context)

                // Anything that moves "today" also invalidates where a widget
                // was paged to: it should be showing the current period again.
                CalendarWidgetSettings.clearAnchors(
                    context,
                    CalendarWidgetProvider.widgetIds(context, manager),
                )

                YantaWidgetUpdater.updateAll(context)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {

        private const val ACTION_MIDNIGHT = "page.yanta.app.widget.MIDNIGHT"

        /**
         * Schedules the next local midnight refresh. Inexact on purpose —
         * a home-screen date flipping a few minutes late costs nothing,
         * while an exact alarm would cost the user battery.
         */
        fun scheduleMidnightRefresh(context: Context) {
            val alarms = context.getSystemService(AlarmManager::class.java) ?: return

            val zone = ZoneId.systemDefault()
            val nextMidnight = LocalDate.now(zone)
                .plusDays(1)
                .atStartOfDay(zone)
                .toInstant()
                .toEpochMilli()

            runCatching {
                alarms.setAndAllowWhileIdle(
                    AlarmManager.RTC,
                    nextMidnight,
                    midnightIntent(context),
                )
            }
        }

        private fun midnightIntent(context: Context): PendingIntent =
            PendingIntent.getBroadcast(
                context,
                MIDNIGHT_REQUEST_CODE,
                Intent(context, WidgetRefreshReceiver::class.java).setAction(ACTION_MIDNIGHT),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        // Kept clear of NotificationScheduler's per-reminder request codes.
        private const val MIDNIGHT_REQUEST_CODE = 910_001
    }
}
