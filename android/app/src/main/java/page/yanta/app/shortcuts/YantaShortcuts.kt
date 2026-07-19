package page.yanta.app.shortcuts

import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import page.yanta.app.MainActivity
import page.yanta.app.R

object YantaShortcuts {
    fun updateDynamicShortcuts(context: Context, snapshotJson: String) {
        if (Build.VERSION.SDK_INT < 25) return

        val manager = context.getSystemService(ShortcutManager::class.java)
        val root = JSONObject(snapshotJson)
        val notes = root.optJSONArray("notes") ?: return

        val shortcuts = mutableListOf<ShortcutInfo>()

        for (i in 0 until minOf(notes.length(), 4)) {
            val note = notes.optJSONObject(i) ?: continue
            val id = note.optString("id")
            val title = note.optString("title", "Note")
            if (id.isBlank()) continue

            shortcuts.add(
                ShortcutInfo.Builder(context, "note_$id")
                    .setShortLabel(title.take(20))
                    .setLongLabel(title)
                    .setIcon(Icon.createWithResource(context, R.drawable.ic_shortcut_note))
                    .setIntent(
                        Intent(context, MainActivity::class.java).apply {
                            action = Intent.ACTION_VIEW
                            data = Uri.parse("https://yanta.page/#${Uri.encode(id)}")
                        }
                    )
                    .build()
            )
        }

        manager.dynamicShortcuts = shortcuts
    }
}