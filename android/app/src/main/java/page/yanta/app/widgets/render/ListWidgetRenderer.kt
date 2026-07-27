package page.yanta.app.widgets.render

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.net.Uri
import androidx.core.net.toUri
import android.widget.RemoteViews
import page.yanta.app.R
import page.yanta.app.widgets.CalendarWidgetService
import page.yanta.app.widgets.data.CalendarWidgetData
import page.yanta.app.widgets.data.CalendarWidgetView
import page.yanta.app.widgets.ui.WidgetIntents
import java.time.ZoneId

/**
 * Scrolling layouts — day and agenda.
 *
 * Both are a header over a collection, so they share one layout and one
 * [CalendarWidgetService] factory; only the header text and the paging step
 * differ. Rows come from a collection rather than nested RemoteViews so the
 * list scrolls and is built off the main thread.
 */
object ListWidgetRenderer {

    /** How far ahead the agenda looks. */
    const val AGENDA_DAYS = 30

    /*
      setRemoteAdapter(Int, Intent) is deprecated for the API 31+ inline
      RemoteCollectionItems, which cannot express a scrolling collection
      backed by a service — the supported path at minSdk 29.
    */
    @Suppress("DEPRECATION")
    fun render(
        render: WidgetRenderContext,
        data: CalendarWidgetData,
        view: CalendarWidgetView,
        zone: ZoneId,
    ): RemoteViews {
        val context = render.context
        val views = RemoteViews(context.packageName, R.layout.widget_calendar_list)

        WidgetChrome.applyBackground(views, render)

        val isDay = view == CalendarWidgetView.DAY

        val count = if (isDay) {
            data.eventsOn(render.anchor, zone).size
        } else {
            data.eventsFrom(render.anchor, zone, AGENDA_DAYS).size
        }

        WidgetChrome.applyHeader(
            views,
            render,
            WidgetChrome.HeaderConfig(
                title = if (isDay) {
                    render.format.dayTitle(render.anchor)
                } else {
                    agendaTitle(render)
                },
                subtitle = subtitle(render, isDay, count),
                canPage = true,
                previous = render.anchor.minusDays(if (isDay) 1 else 7),
                next = render.anchor.plusDays(if (isDay) 1 else 7),
                createFor = render.anchor,
            ),
        )

        views.setRemoteAdapter(R.id.widget_list, adapterIntent(render, view))
        views.setPendingIntentTemplate(
            R.id.widget_list,
            WidgetIntents.collectionTemplate(context, render.widgetId),
        )
        views.setEmptyView(R.id.widget_list, R.id.widget_empty)

        views.tint(R.id.widget_empty_icon, render.theme.textFaint, render.theme)
        views.setThemedTextColor(R.id.widget_empty_text, render.theme.textDim, render.theme)
        views.setTextViewText(
            R.id.widget_empty_text,
            when {
                !render.hasData -> context.getString(R.string.widget_needs_sync)
                isDay -> context.getString(R.string.widget_empty_day)
                else -> context.getString(R.string.widget_empty_agenda)
            },
        )

        return views
    }

    /**
     * The adapter intent doubles as the collection's identity: the launcher
     * keeps one factory per distinct intent, so the view and the shown
     * period have to be part of it or paging would redraw stale rows.
     */
    private fun adapterIntent(render: WidgetRenderContext, view: CalendarWidgetView): Intent =
        Intent(render.context, CalendarWidgetService::class.java).apply {
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, render.widgetId)
            data = "yanta-widget://list/${render.widgetId}/${view.id}/${render.anchor.toEpochDay()}".toUri()
        }

    private fun agendaTitle(render: WidgetRenderContext): String =
        if (render.anchor == render.today) {
            render.context.getString(R.string.widget_agenda_title)
        } else {
            render.format.dayShort(render.anchor)
        }

    private fun subtitle(render: WidgetRenderContext, isDay: Boolean, count: Int): String {
        if (!render.hasData) return render.context.getString(R.string.widget_needs_sync)

        val events = WidgetChrome.eventCountLabel(render, count)

        return when {
            isDay && render.anchor == render.today ->
                render.context.getString(R.string.widget_subtitle_today, events)

            isDay -> events

            else -> render.context.getString(R.string.widget_subtitle_agenda, events, AGENDA_DAYS)
        }
    }
}
