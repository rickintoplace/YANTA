package page.yanta.app

import android.app.Application
import page.yanta.app.notifications.NotificationChannels

class YantaApp : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationChannels.ensure(this)
    }
}