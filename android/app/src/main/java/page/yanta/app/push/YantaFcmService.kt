package page.yanta.app.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import page.yanta.app.notifications.ChatNotifier

/**
 * Receives Matrix pushes via FCM while the app is closed.
 *
 * The Matrix pusher is registered by the web layer with
 * data.format = 'event_id_only' (see chat-notifications.js). Sygnal therefore
 * sends only metadata — never message content:
 *
 *   { event_id, room_id, prio, unread, missed_calls }
 *
 * Content stays end-to-end encrypted; the notification is generic. Tapping it
 * opens the room, where the WebView decrypts normally.
 */
class YantaFcmService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        // Web layer re-registers the Matrix pusher with the new pushkey.
        PushTokenStore.saveToken(this, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val roomId = data["room_id"].orEmpty()
        val unread = data["unread"]?.toIntOrNull()

        /*
         * unread == 0 without a room means the user read everything on another
         * device — Matrix sends this so stale notifications get dismissed.
         */
        if (roomId.isBlank()) {
            if (unread == 0) ChatNotifier.clear(this)
            return
        }

        ChatNotifier.showMessage(
            context = this,
            roomId = roomId,
            title = "YANTA",
            body = "New encrypted message",
            timestamp = message.sentTime.takeIf { it > 0 } ?: System.currentTimeMillis(),
        )
    }
}
