package page.yanta.app.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

object NotificationChannels {
    const val CALENDAR = "yanta_calendar_events"

    fun ensure(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return

        val manager = context.getSystemService(NotificationManager::class.java)

        val channel = NotificationChannel(
            CALENDAR,
            "Calendar events",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Reminders for YANTA calendar events"
            enableVibration(true)
            setShowBadge(true)
        }

        manager.createNotificationChannel(channel)
    }
}