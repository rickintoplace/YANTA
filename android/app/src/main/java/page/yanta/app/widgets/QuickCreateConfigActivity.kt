package page.yanta.app.widgets

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import page.yanta.app.R
import page.yanta.app.widgets.data.CalendarWidgetStore
import page.yanta.app.widgets.data.QuickAction
import page.yanta.app.widgets.data.QuickCreateSettings
import page.yanta.app.widgets.ui.WidgetTheme

/**
 * Action picker for a Quick Create widget: which actions it offers and in
 * which order.
 *
 * Two lists rather than drag-and-drop — chosen actions with reorder and
 * remove controls, the rest one tap away — because a widget configuration
 * screen has to work on a first try, without a gesture to discover.
 *
 * Runs both as the widget's configuration activity while it is being placed
 * and as a plain screen opened from the widget, so it always reports a
 * result and never assumes the widget is new.
 */
class QuickCreateConfigActivity : Activity() {

    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private var selected = mutableListOf<QuickAction>()

    /* Edits apply live so the widget behind the sheet previews them; leaving
       without confirming has to put the previous selection back. */
    private var original: List<QuickAction>? = null
    private var confirmed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        widgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        // Backing out while placing a widget must cancel the placement.
        setResult(RESULT_CANCELED, resultIntent())

        original = QuickCreateSettings.storedActions(this, widgetId)
        selected = QuickCreateSettings.actions(this, widgetId).toMutableList()

        setContentView(R.layout.activity_quick_create_config)
        bind()
    }

    private fun bind() {
        val theme = WidgetTheme.resolve(this, CalendarWidgetStore.read(this).theme)

        findViewById<View>(R.id.config_scrim).apply {
            setBackgroundColor(SCRIM_COLOR)
            setOnClickListener { finish() }
        }

        findViewById<ImageView>(R.id.config_card_background)
            .setColorFilter(theme.value(theme.background))
        findViewById<TextView>(R.id.config_title).setTextColor(theme.value(theme.text))
        findViewById<TextView>(R.id.config_subtitle).setTextColor(theme.value(theme.textDim))
        findViewById<TextView>(R.id.config_selected_label)
            .setTextColor(theme.value(theme.textDim))
        findViewById<TextView>(R.id.config_available_label)
            .setTextColor(theme.value(theme.textDim))

        findViewById<TextView>(R.id.config_done).apply {
            ViewCompat.setBackgroundTintList(
                this,
                ColorStateList.valueOf(theme.value(theme.accent)),
            )
            setTextColor(theme.onAccent)
            setOnClickListener { confirm() }
        }

        renderLists(theme)
    }

    private fun renderLists(theme: WidgetTheme) {
        val chosen = findViewById<LinearLayout>(R.id.config_selected)
        val available = findViewById<LinearLayout>(R.id.config_available)

        chosen.removeAllViews()
        selected.forEachIndexed { index, action ->
            chosen.addView(selectedRow(chosen, action, index, theme))
        }

        val rest = QuickAction.entries.filter { it !in selected }

        findViewById<View>(R.id.config_available_label).visibility =
            if (rest.isEmpty()) View.GONE else View.VISIBLE

        available.removeAllViews()
        rest.forEach { action ->
            available.addView(availableRow(available, action, theme))
        }
    }

    private fun selectedRow(
        parent: ViewGroup,
        action: QuickAction,
        index: Int,
        theme: WidgetTheme,
    ): View {
        val row = inflateRow(parent, action, theme, surface = theme.value(theme.accent))

        row.findViewById<ImageView>(R.id.row_background).imageAlpha = SELECTED_SURFACE_ALPHA
        row.findViewById<ImageView>(R.id.row_icon).setColorFilter(theme.value(theme.accent))
        row.findViewById<View>(R.id.row_add).visibility = View.GONE

        // The last action cannot be removed: an empty widget does nothing.
        val removable = selected.size > 1

        bindControl(row, R.id.row_up, theme, enabled = index > 0) {
            move(index, index - 1, theme)
        }
        bindControl(row, R.id.row_down, theme, enabled = index < selected.lastIndex) {
            move(index, index + 1, theme)
        }
        bindControl(row, R.id.row_remove, theme, enabled = removable) {
            selected.removeAt(index)
            persist(theme)
        }

        return row
    }

    private fun availableRow(
        parent: ViewGroup,
        action: QuickAction,
        theme: WidgetTheme,
    ): View {
        val row = inflateRow(parent, action, theme, surface = theme.value(theme.surface))

        row.findViewById<ImageView>(R.id.row_icon).setColorFilter(theme.value(theme.textDim))
        listOf(R.id.row_up, R.id.row_down, R.id.row_remove).forEach {
            row.findViewById<View>(it).visibility = View.GONE
        }

        bindControl(row, R.id.row_add, theme, enabled = true) {
            selected.add(action)
            persist(theme)
        }

        row.setOnClickListener {
            selected.add(action)
            persist(theme)
        }

        return row
    }

    private fun inflateRow(
        parent: ViewGroup,
        action: QuickAction,
        theme: WidgetTheme,
        surface: Int,
    ): View {
        val row = LayoutInflater.from(this)
            .inflate(R.layout.item_quick_action_row, parent, false)

        row.findViewById<ImageView>(R.id.row_background).setColorFilter(surface)
        row.findViewById<ImageView>(R.id.row_icon).setImageResource(action.iconRes)
        row.findViewById<TextView>(R.id.row_label).apply {
            setText(action.labelRes)
            setTextColor(theme.value(theme.text))
        }

        return row
    }

    private inline fun bindControl(
        row: View,
        id: Int,
        theme: WidgetTheme,
        enabled: Boolean,
        crossinline onClick: () -> Unit,
    ) {
        row.findViewById<ImageView>(id).apply {
            setColorFilter(theme.value(if (enabled) theme.textDim else theme.textFaint))
            alpha = if (enabled) 1f else DISABLED_ALPHA
            isEnabled = enabled
            setOnClickListener { if (enabled) onClick() }
        }
    }

    private fun move(from: Int, to: Int, theme: WidgetTheme) {
        selected.add(to, selected.removeAt(from))
        persist(theme)
    }

    /** Every edit is live: the widget behind the sheet updates as you go. */
    private fun persist(theme: WidgetTheme) {
        QuickCreateSettings.setActions(this, widgetId, selected)
        renderLists(theme)
        renderWidget()
    }

    private fun confirm() {
        confirmed = true
        QuickCreateSettings.setActions(this, widgetId, selected)
        renderWidget()
        setResult(RESULT_OK, resultIntent())
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()

        if (confirmed || widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return

        original
            ?.let { QuickCreateSettings.setActions(this, widgetId, it) }
            ?: QuickCreateSettings.forget(this, intArrayOf(widgetId))

        renderWidget()
    }

    private fun renderWidget() {
        WidgetWork.execute {
            QuickCreateWidgetProvider.render(
                applicationContext,
                AppWidgetManager.getInstance(applicationContext),
                widgetId,
            )
        }
    }

    private fun resultIntent() = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)

    private companion object {
        val SCRIM_COLOR = Color.argb(150, 0, 0, 0)

        const val SELECTED_SURFACE_ALPHA = 56
        const val DISABLED_ALPHA = 0.35f
    }
}
