package page.yanta.app.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import page.yanta.app.BuildConfig
import page.yanta.app.MainActivity
import page.yanta.app.R

/**
 * Central chat notification renderer.
 *
 * Used by two producers:
 * 1. YantaFcmService — app closed, payload is event_id_only (no content).
 * 2. YantaJsBridge.showChatNotification — app open, web layer has already
 *    decrypted the message and passes title/body.
 *
 * One notification per room (tag = roomId), grouped under a summary, so the
 * tray behaves like WhatsApp: one row per conversation, badge on the launcher.
 */
object ChatNotifier {

    const val CHANNEL_ID = "chat_messages"
    private const val GROUP_KEY = "page.yanta.app.CHAT"
    private const val SUMMARY_ID = 424242
    const val EXTRA_CHAT_ROOM_ID = "yanta.extra.CHAT_ROOM_ID"

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Chat messages",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "New encrypted chat messages"
            enableVibration(true)
            setShowBadge(true)
            lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
        }
        manager.createNotificationChannel(channel)
    }

    fun showMessage(
        context: Context,
        roomId: String,
        title: String,
        body: String,
        timestamp: Long = System.currentTimeMillis(),
    ) {
        if (roomId.isBlank()) return
        ensureChannel(context)

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title.ifBlank { "New message" })
            .setContentText(body.ifBlank { "New encrypted message" })
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setWhen(timestamp)
            .setShowWhen(true)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setGroup(GROUP_KEY)
            .setContentIntent(openChatIntent(context, roomId))

        val summary = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("YANTA Chat")
            .setGroup(GROUP_KEY)
            .setGroupSummary(true)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(openChatIntent(context, ""))

        NotificationManagerCompat.from(context).apply {
            if (!areNotificationsEnabled()) return
            notify(roomId, notificationId(roomId), builder.build())
            notify(SUMMARY_ID, summary.build())
        }
    }

    /** Clears notifications for one room, or all chat notifications when blank. */
    fun clear(context: Context, roomId: String = "") {
        val manager = NotificationManagerCompat.from(context)
        if (roomId.isBlank()) {
            manager.cancelAll()
            return
        }
        manager.cancel(roomId, notificationId(roomId))
    }

    private fun notificationId(roomId: String): Int =
        roomId.hashCode() and 0x7FFFFFFF

    /**
     * Deep link into MainActivity. singleTask + onNewIntent means the running
     * WebView receives the roomId as an extra and dispatches a JS event
     * instead of reloading the SPA. Cold start loads /#chat/<roomId>.
     */
    private fun openChatIntent(context: Context, roomId: String): PendingIntent {
        val hash = if (roomId.isBlank()) "" else "#chat/${Uri.encode(roomId)}"
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("${BuildConfig.YANTA_URL}/$hash")
            putExtra(EXTRA_CHAT_ROOM_ID, roomId)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        return PendingIntent.getActivity(
            context,
            notificationId("open:$roomId"),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
