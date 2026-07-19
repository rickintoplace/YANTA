package page.yanta.app.notifications

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import page.yanta.app.MainActivity
import page.yanta.app.R
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        NotificationChannels.ensure(context)

        if (
            Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        val eventId = intent.getStringExtra("eventId") ?: return
        val title = intent.getStringExtra("title") ?: "Calendar event"
        val startIso = intent.getStringExtra("startIso") ?: ""
        val requestCode = intent.getIntExtra("requestCode", eventId.hashCode())

        val openIntent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("https://yanta.page/#calendar/${Uri.encode(eventId)}")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        val contentIntent = PendingIntent.getActivity(
            context,
            requestCode,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val whenText = formatStart(startIso)

        val notification = NotificationCompat.Builder(context, NotificationChannels.CALENDAR)
            .setSmallIcon(R.drawable.ic_stat_yanta)
            .setContentTitle(title)
            .setContentText(whenText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(whenText))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .build()

        context.getSystemService(NotificationManager::class.java)
            .notify(requestCode, notification)
    }

    private fun formatStart(startIso: String): String {
        return try {
            val instant = Instant.parse(startIso)
            val fmt = DateTimeFormatter.ofPattern("EEE, dd MMM · HH:mm")
                .withZone(ZoneId.systemDefault())
            "Starts ${fmt.format(instant)}"
        } catch (_: Throwable) {
            "Event reminder"
        }
    }
}