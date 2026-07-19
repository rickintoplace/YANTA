package page.yanta.app.notifications

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject
import page.yanta.app.data.NativeStore
import java.time.Instant
import kotlin.math.abs

object NotificationScheduler {

    fun rescheduleFromStore(context: Context) {
        scheduleFromSnapshot(context, NativeStore.snapshot(context))
    }

    fun scheduleFromSnapshot(context: Context, snapshotJson: String) {
        NativeStore.saveSnapshot(context, snapshotJson)
        cancelPrevious(context)

        val now = System.currentTimeMillis()
        val newCodes = mutableSetOf<Int>()

        val root = JSONObject(snapshotJson)
        val events = root.optJSONArray("calendarEvents") ?: return

        for (i in 0 until events.length()) {
            val event = events.optJSONObject(i) ?: continue
            val eventId = event.optString("id")
            val title = event.optString("title", "Calendar event")
            val startIso = event.optString("start")
            val startMs = parseIsoMs(startIso) ?: continue
            val reminders = event.optJSONArray("reminders") ?: continue

            for (r in 0 until reminders.length()) {
                val reminder = reminders.optJSONObject(r) ?: continue
                if (!reminder.optBoolean("enabled", true)) continue

                val reminderId = reminder.optString("id", "r$r")
                val minutesBefore = reminder.optInt("minutesBefore", 10)
                val triggerAt = startMs - minutesBefore * 60_000L

                if (triggerAt <= now + 5_000L) continue

                val code = stableCode("$eventId:$reminderId:$triggerAt")
                scheduleOne(
                    context = context,
                    requestCode = code,
                    eventId = eventId,
                    title = title,
                    startIso = startIso,
                    triggerAt = triggerAt,
                    minutesBefore = minutesBefore
                )
                newCodes.add(code)
            }
        }

        NativeStore.saveAlarmCodes(context, newCodes)
    }

    private fun scheduleOne(
        context: Context,
        requestCode: Int,
        eventId: String,
        title: String,
        startIso: String,
        triggerAt: Long,
        minutesBefore: Int
    ) {
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            putExtra("eventId", eventId)
            putExtra("title", title)
            putExtra("startIso", startIso)
            putExtra("minutesBefore", minutesBefore)
            putExtra("requestCode", requestCode)
        }

        val pendingIntent = PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        if (Build.VERSION.SDK_INT >= 31 && !alarmManager.canScheduleExactAlarms()) {
            alarmManager.setAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                triggerAt,
                pendingIntent
            )
            return
        }

        alarmManager.setExactAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP,
            triggerAt,
            pendingIntent
        )
    }

    private fun cancelPrevious(context: Context) {
        val alarmManager = context.getSystemService(AlarmManager::class.java)

        for (code in NativeStore.alarmCodes(context)) {
            val intent = Intent(context, AlarmReceiver::class.java)
            val pi = PendingIntent.getBroadcast(
                context,
                code,
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (pi != null) {
                alarmManager.cancel(pi)
                pi.cancel()
            }
        }

        NativeStore.saveAlarmCodes(context, emptySet())
    }

    private fun parseIsoMs(value: String): Long? {
        return try {
            Instant.parse(value).toEpochMilli()
        } catch (_: Throwable) {
            null
        }
    }

    private fun stableCode(value: String): Int {
        return abs(value.hashCode())
    }
}