package page.yanta.app.notifications

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject
import page.yanta.app.data.NativeStore
import java.time.Instant
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.abs

object NotificationScheduler {

    /*
     * Android refuses more than 500 pending alarms per app (and throws, which
     * used to abort the pass before the alarm codes were saved). The nearest
     * ones are what matters; later ones are scheduled on a later pass — every
     * app open and every change runs one.
     */
    private const val MAX_ALARMS = 400

    // Keeps onResume's pass off the main thread; the lock below orders it
    // against the bridge's.
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()

    private data class Alarm(
        val code: Int,
        val eventId: String,
        val title: String,
        val startIso: String,
        val allDay: Boolean,
        val triggerAt: Long,
        val minutesBefore: Int
    )

    fun rescheduleFromStoreAsync(context: Context) {
        val app = context.applicationContext
        worker.execute { rescheduleFromStore(app) }
    }

    @Synchronized
    fun rescheduleFromStore(context: Context) {
        scheduleFromSnapshot(context, NativeStore.snapshot(context))
    }

    /*
     * Synchronized: onResume and the web layer both start a pass when the app
     * comes back, on different threads. Interleaved, one pass saved its alarm
     * codes over the other's, the overwritten alarms could never be cancelled
     * again, and each fired beside its replacement — the same reminder two or
     * three times at once.
     */
    @Synchronized
    fun scheduleFromSnapshot(context: Context, snapshotJson: String) {
        NativeStore.saveSnapshot(context, snapshotJson)
        cancelPrevious(context)

        val alarms = alarmsFromSnapshot(snapshotJson, System.currentTimeMillis())
        val scheduled = mutableSetOf<Int>()

        try {
            for (alarm in alarms) {
                try {
                    scheduleOne(context, alarm)
                    scheduled.add(alarm.code)
                } catch (_: Throwable) {
                    // One refused alarm must not cost the others.
                }
            }
        } finally {
            NativeStore.saveAlarmCodes(context, scheduled)
        }
    }

    /**
     * Whether a firing alarm still matches the current snapshot. An alarm
     * left over from an older version of the event (moved, deleted, reminder
     * removed) stays silent instead of announcing a time that is no longer
     * true. Fails open: without a readable snapshot it fires.
     */
    fun isCurrent(context: Context, eventId: String, startIso: String, minutesBefore: Int): Boolean {
        return try {
            val events = JSONObject(NativeStore.snapshot(context)).optJSONArray("calendarEvents")
                ?: return true

            for (i in 0 until events.length()) {
                val event = events.optJSONObject(i) ?: continue
                if (event.optString("id") != eventId) continue
                if (event.optString("start") != startIso) continue

                val reminders = event.optJSONArray("reminders") ?: continue
                for (r in 0 until reminders.length()) {
                    val reminder = reminders.optJSONObject(r) ?: continue
                    if (
                        reminder.optBoolean("enabled", true) &&
                        reminder.optInt("minutesBefore", 10) == minutesBefore
                    ) return true
                }
            }

            false
        } catch (_: Throwable) {
            true
        }
    }

    private fun alarmsFromSnapshot(snapshotJson: String, now: Long): List<Alarm> {
        val events = try {
            JSONObject(snapshotJson).optJSONArray("calendarEvents")
        } catch (_: Throwable) {
            null
        } ?: return emptyList()

        // Keyed by code: one alarm per event and moment, however many
        // reminder entries ask for it.
        val byCode = linkedMapOf<Int, Alarm>()

        for (i in 0 until events.length()) {
            val event = events.optJSONObject(i) ?: continue
            val eventId = event.optString("id")
            val title = event.optString("title", "Calendar event")
            val startIso = event.optString("start")
            val allDay = event.optBoolean("allDay", false)
            val startMs = parseIsoMs(startIso) ?: continue
            val reminders = event.optJSONArray("reminders") ?: continue

            for (r in 0 until reminders.length()) {
                val reminder = reminders.optJSONObject(r) ?: continue
                if (!reminder.optBoolean("enabled", true)) continue

                val minutesBefore = reminder.optInt("minutesBefore", 10)
                val triggerAt = startMs - minutesBefore * 60_000L

                if (triggerAt <= now + 5_000L) continue

                /*
                 * Not keyed by the reminder's id: the editor used to hand out
                 * new ids on every save, so each save made a new alarm, and
                 * any that escaped cancellation fired as a duplicate. With
                 * event and moment as the key, a re-schedule replaces.
                 */
                val code = stableCode("$eventId:$triggerAt")
                byCode[code] = Alarm(code, eventId, title, startIso, allDay, triggerAt, minutesBefore)
            }
        }

        return byCode.values.sortedBy { it.triggerAt }.take(MAX_ALARMS)
    }

    private fun scheduleOne(context: Context, alarm: Alarm) {
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            putExtra("eventId", alarm.eventId)
            putExtra("title", alarm.title)
            putExtra("startIso", alarm.startIso)
            // Without this the receiver cannot tell an all-day event from one
            // that genuinely starts at midnight, and shows "00:00" for both.
            putExtra("allDay", alarm.allDay)
            putExtra("minutesBefore", alarm.minutesBefore)
            putExtra("requestCode", alarm.code)
        }

        val pendingIntent = PendingIntent.getBroadcast(
            context,
            alarm.code,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        if (Build.VERSION.SDK_INT >= 31 && !alarmManager.canScheduleExactAlarms()) {
            alarmManager.setAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                alarm.triggerAt,
                pendingIntent
            )
            return
        }

        alarmManager.setExactAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP,
            alarm.triggerAt,
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