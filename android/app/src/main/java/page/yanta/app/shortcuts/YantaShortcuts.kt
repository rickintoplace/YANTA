package page.yanta.app.shortcuts

import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import page.yanta.app.MainActivity
import page.yanta.app.R

object YantaShortcuts {
    fun updateDynamicShortcuts(context: Context, snapshotJson: String) {
        if (Build.VERSION.SDK_INT < 25) return

        val manager = context.getSystemService(ShortcutManager::class.java)
        val root = JSONObject(snapshotJson)

        val shortcuts = mutableListOf<ShortcutInfo>()

        // Actions the web layer offers only to some people (the cycle
        // calendar's), first: they are what a long-press is for.
        val actions = root.optJSONArray("quickActions")
        for (i in 0 until (actions?.length() ?: 0)) {
            val action = actions?.optJSONObject(i) ?: continue
            val id = action.optString("id")
            val label = action.optString("label")
            if (id.isBlank() || label.isBlank()) continue

            shortcuts.add(
                ShortcutInfo.Builder(context, "action_$id")
                    .setShortLabel(label.take(20))
                    .setLongLabel(action.optString("longLabel", label))
                    .setRank(0)
                    .setIcon(Icon.createWithResource(context, R.drawable.ic_shortcut_note))
                    .setIntent(
                        Intent(context, MainActivity::class.java).apply {
                            this.action = Intent.ACTION_VIEW
                            data = Uri.parse("yanta://open?action=${Uri.encode(id)}")
                        }
                    )
                    .build()
            )
        }

        val notes = root.optJSONArray("notes") ?: JSONArray()
        val noteSlots = maxOf(0, 4 - shortcuts.size)

        for (i in 0 until minOf(notes.length(), noteSlots)) {
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