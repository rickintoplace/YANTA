package page.yanta.app.widgets.render

import android.content.Context
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import page.yanta.app.R
import page.yanta.app.widgets.data.MonthDensity
import page.yanta.app.widgets.data.WidgetEvent
import page.yanta.app.widgets.ui.WidgetFormat
import page.yanta.app.widgets.ui.WidgetColor
import page.yanta.app.widgets.ui.WidgetIntents
import page.yanta.app.widgets.ui.WidgetTheme
import java.time.LocalDate

/**
 * What a renderer needs to draw one widget instance: the resolved theme,
 * the formatter honouring the user's calendar preferences, the period the
 * widget is showing and how much room it has.
 */
data class WidgetRenderContext(
    val context: Context,
    val widgetId: Int,
    val theme: WidgetTheme,
    val format: WidgetFormat,
    val anchor: LocalDate,
    val today: LocalDate,
    val monthDensity: MonthDensity,
    val widthDp: Int,
    val heightDp: Int,
    val hasData: Boolean,
)

/**
 * Shared widget chrome — background surface and header — so the four
 * layouts stay visually identical where they should be and differ only in
 * their content area.
 */
object WidgetChrome {

    /** Header buttons a layout offers. */
    data class HeaderConfig(
        val title: String,
        val subtitle: String,
        val canPage: Boolean,
        val previous: LocalDate? = null,
        val next: LocalDate? = null,
        val createFor: LocalDate,
    )

    fun applyBackground(views: RemoteViews, render: WidgetRenderContext) {
        views.tint(R.id.widget_background, render.theme.background, render.theme)
        views.setOnClickPendingIntent(
            R.id.widget_background,
            WidgetIntents.openCalendar(render.context, render.widgetId),
        )
    }

    fun applyHeader(
        views: RemoteViews,
        render: WidgetRenderContext,
        config: HeaderConfig,
    ) {
        val context = render.context
        val theme = render.theme

        views.setTextViewText(R.id.widget_title, config.title)
        views.setThemedTextColor(R.id.widget_title, theme.text, theme)

        views.setTextViewText(R.id.widget_subtitle, config.subtitle)
        views.setThemedTextColor(R.id.widget_subtitle, theme.textDim, theme)
        views.setViewVisibility(
            R.id.widget_subtitle,
            if (config.subtitle.isBlank()) View.GONE else View.VISIBLE,
        )

        views.setOnClickPendingIntent(
            R.id.widget_header_title_group,
            WidgetIntents.openCalendar(context, render.widgetId),
        )

        /*
          Paging chevrons cost 60dp. A narrow widget keeps the actions that
          cannot be reached any other way and drops the ones that can — the
          app itself is one tap away.
        */
        val roomForPaging = config.canPage && render.widthDp >= NARROW_WIDTH_DP
        val offToday = render.anchor != render.today

        views.bindIconButton(
            id = R.id.widget_btn_prev,
            visible = roomForPaging,
            color = theme.textDim,
            theme = theme,
        ) { WidgetIntents.navigateTo(context, render.widgetId, config.previous) }

        views.bindIconButton(
            id = R.id.widget_btn_next,
            visible = roomForPaging,
            color = theme.textDim,
            theme = theme,
        ) { WidgetIntents.navigateTo(context, render.widgetId, config.next) }

        // "Today" only appears once the widget has been paged away from it.
        views.bindIconButton(
            id = R.id.widget_btn_today,
            visible = config.canPage && offToday,
            color = theme.accent,
            theme = theme,
        ) { WidgetIntents.navigateTo(context, render.widgetId, null) }

        views.bindIconButton(
            id = R.id.widget_btn_add,
            visible = render.widthDp >= NARROW_WIDTH_DP,
            color = theme.textDim,
            theme = theme,
        ) { WidgetIntents.createEvent(context, render.widgetId, config.createFor) }

        views.bindIconButton(
            id = R.id.widget_btn_views,
            visible = true,
            color = theme.textDim,
            theme = theme,
        ) { WidgetIntents.openViewPicker(context, render.widgetId) }
    }

    /** "3 events", "No events", or a nudge while the app has never synced. */
    fun countSubtitle(render: WidgetRenderContext, count: Int): String =
        if (render.hasData) {
            eventCountLabel(render, count)
        } else {
            render.context.getString(R.string.widget_needs_sync)
        }

    fun eventCountLabel(render: WidgetRenderContext, count: Int): String =
        if (count == 0) {
            render.context.getString(R.string.widget_no_events)
        } else {
            render.context.resources.getQuantityString(
                R.plurals.widget_event_count,
                count,
                count,
            )
        }

    private const val NARROW_WIDTH_DP = 200
}

// ------------------------------------------------------------
// RemoteViews helpers
//
// Two mechanics live here so the renderers do not repeat them:
//
// - Themed surfaces are ImageViews whose drawable is colour-filtered.
//   RemoteViews cannot tint a background drawable before API 31, and this
//   works on every supported level.
//
// - Colours that follow the system theme are recorded for both night modes
//   via setColorInt (API 31+), so toggling dark mode repaints the widget
//   without waiting for the next data sync. Below that the value is baked
//   in, and a theme toggle lands with the next update.
// ------------------------------------------------------------

fun RemoteViews.tint(viewId: Int, color: Int, alpha: Int = 255) {
    setInt(viewId, "setColorFilter", color)
    setInt(viewId, "setImageAlpha", alpha.coerceIn(0, 255))
}

fun RemoteViews.tint(
    viewId: Int,
    color: WidgetColor,
    theme: WidgetTheme,
    alpha: Int = 255,
) {
    setThemedColor(viewId, "setColorFilter", color, theme)
    setInt(viewId, "setImageAlpha", alpha.coerceIn(0, 255))
}

fun RemoteViews.setThemedTextColor(viewId: Int, color: WidgetColor, theme: WidgetTheme) {
    setThemedColor(viewId, "setTextColor", color, theme)
}

private fun RemoteViews.setThemedColor(
    viewId: Int,
    method: String,
    color: WidgetColor,
    theme: WidgetTheme,
) {
    if (theme.followsSystem && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        setColorInt(viewId, method, color.light, color.dark)
    } else {
        setInt(viewId, method, theme.value(color))
    }
}

private inline fun RemoteViews.bindIconButton(
    id: Int,
    visible: Boolean,
    color: WidgetColor,
    theme: WidgetTheme,
    intent: () -> android.app.PendingIntent,
) {
    setViewVisibility(id, if (visible) View.VISIBLE else View.GONE)
    if (!visible) return

    tint(id, color, theme)
    setOnClickPendingIntent(id, intent())
}

/**
 * Shared chip binding for the month and week grids.
 *
 * All-day and multi-day events read as filled blocks, timed events as a
 * tinted wash with the event colour as text — the same visual hierarchy
 * the app's month and week views use.
 */
fun RemoteViews.bindEventChip(
    event: WidgetEvent,
    theme: WidgetTheme,
    zone: java.time.ZoneId,
) {
    val filled = event.allDay || event.spansMultipleDays(zone)

    if (filled) {
        tint(R.id.chip_background, event.color)
        setTextColor(R.id.chip_title, theme.readableTextOn(event.color))
    } else {
        tint(R.id.chip_background, event.color, SOFT_CHIP_ALPHA)
        setThemedTextColor(R.id.chip_title, theme.text, theme)
    }

    setTextViewText(R.id.chip_title, event.title)
}

/** Week chips add the start time above the title; month chips never do. */
fun RemoteViews.bindChipTime(
    event: WidgetEvent,
    theme: WidgetTheme,
    format: WidgetFormat,
    zone: java.time.ZoneId,
) {
    val filled = event.allDay || event.spansMultipleDays(zone)

    if (filled) {
        setViewVisibility(R.id.chip_time, View.GONE)
        return
    }

    setViewVisibility(R.id.chip_time, View.VISIBLE)
    setTextViewText(R.id.chip_time, format.timeCompact(event.startMs))
    setTextColor(R.id.chip_time, event.color)
}

private const val SOFT_CHIP_ALPHA = 46
