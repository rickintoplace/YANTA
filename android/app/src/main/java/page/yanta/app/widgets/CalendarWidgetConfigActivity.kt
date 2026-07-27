package page.yanta.app.widgets

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import page.yanta.app.R
import page.yanta.app.widgets.data.CalendarWidgetSettings
import page.yanta.app.widgets.data.CalendarWidgetStore
import page.yanta.app.widgets.data.CalendarWidgetView
import page.yanta.app.widgets.data.MonthDensity
import page.yanta.app.widgets.ui.WidgetTheme

/**
 * Layout picker for a calendar widget.
 *
 * Runs both as the widget's configuration activity (shown while placing it)
 * and as a plain screen opened from the widget header, which is why it
 * always reports a result and never assumes the widget is new.
 */
class CalendarWidgetConfigActivity : Activity() {

    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    private data class Option(
        val view: CalendarWidgetView,
        val iconRes: Int,
        val titleRes: Int,
        val descriptionRes: Int,
    )

    private val options = listOf(
        Option(
            CalendarWidgetView.MONTH,
            R.drawable.ic_widget_view_month,
            R.string.widget_view_month,
            R.string.widget_view_month_hint,
        ),
        Option(
            CalendarWidgetView.WEEK,
            R.drawable.ic_widget_view_week,
            R.string.widget_view_week,
            R.string.widget_view_week_hint,
        ),
        Option(
            CalendarWidgetView.DAY,
            R.drawable.ic_widget_view_day,
            R.string.widget_view_day,
            R.string.widget_view_day_hint,
        ),
        Option(
            CalendarWidgetView.AGENDA,
            R.drawable.ic_widget_view_agenda,
            R.string.widget_view_agenda,
            R.string.widget_view_agenda_hint,
        ),
    )

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

        setContentView(R.layout.activity_widget_config)
        bind()
    }

    private data class DensityOption(
        val density: MonthDensity,
        val iconRes: Int,
        val labelRes: Int,
    )

    private val densityOptions = listOf(
        DensityOption(
            MonthDensity.TITLES,
            R.drawable.ic_widget_month_titles,
            R.string.widget_month_density_titles,
        ),
        DensityOption(
            MonthDensity.DOTS,
            R.drawable.ic_widget_month_dots,
            R.string.widget_month_density_dots,
        ),
    )

    private fun bind() {
        val theme = WidgetTheme.resolve(this, CalendarWidgetStore.read(this).theme)
        val selected = CalendarWidgetSettings.view(this, widgetId)
        val density = CalendarWidgetSettings.monthDensity(this, widgetId)

        findViewById<View>(R.id.config_scrim).setBackgroundColor(SCRIM_COLOR)
        findViewById<ImageView>(R.id.config_card_background).setColorFilter(theme.value(theme.background))
        findViewById<TextView>(R.id.config_title).setTextColor(theme.value(theme.text))
        findViewById<TextView>(R.id.config_subtitle).setTextColor(theme.value(theme.textDim))
        findViewById<TextView>(R.id.config_month_label).setTextColor(theme.value(theme.textDim))

        val container = findViewById<LinearLayout>(R.id.config_options)
        container.removeAllViews()

        options.forEach { option ->
            container.addView(optionView(container, option, option.view == selected, theme))
        }

        /*
          The density pills also switch the widget to the month layout, so
          the compact variant is one tap away rather than two.
        */
        val densityContainer = findViewById<LinearLayout>(R.id.config_month_options)
        densityContainer.removeAllViews()

        densityOptions.forEachIndexed { index, option ->
            densityContainer.addView(
                densityView(
                    parent = densityContainer,
                    option = option,
                    isSelected = option.density == density && selected == CalendarWidgetView.MONTH,
                    isFirst = index == 0,
                    theme = theme,
                )
            )
        }

        // Tapping outside the card is a cancel, like a sheet.
        findViewById<View>(R.id.config_scrim).setOnClickListener { finish() }
    }

    private fun densityView(
        parent: ViewGroup,
        option: DensityOption,
        isSelected: Boolean,
        isFirst: Boolean,
        theme: WidgetTheme,
    ): View {
        val row = LayoutInflater.from(this)
            .inflate(R.layout.item_widget_config_choice, parent, false)

        row.findViewById<ImageView>(R.id.choice_background).apply {
            setColorFilter(if (isSelected) theme.value(theme.accent) else theme.value(theme.surface))
            imageAlpha = if (isSelected) SELECTED_SURFACE_ALPHA else 255
        }

        row.findViewById<ImageView>(R.id.choice_icon).apply {
            setImageResource(option.iconRes)
            setColorFilter(if (isSelected) theme.value(theme.accent) else theme.value(theme.textDim))
        }

        row.findViewById<TextView>(R.id.choice_label).apply {
            setText(option.labelRes)
            setTextColor(theme.value(theme.text))
        }

        (row.layoutParams as? LinearLayout.LayoutParams)?.marginStart =
            if (isFirst) 0 else resources.getDimensionPixelSize(R.dimen.widget_config_choice_gap)

        row.setOnClickListener {
            CalendarWidgetSettings.setMonthDensity(this, widgetId, option.density)
            select(CalendarWidgetView.MONTH)
        }

        return row
    }

    private fun optionView(
        parent: ViewGroup,
        option: Option,
        isSelected: Boolean,
        theme: WidgetTheme,
    ): View {
        val row = LayoutInflater.from(this)
            .inflate(R.layout.item_widget_config_option, parent, false)

        row.findViewById<ImageView>(R.id.option_background).setColorFilter(
            if (isSelected) theme.value(theme.accent) else theme.value(theme.surface)
        )
        row.findViewById<ImageView>(R.id.option_background).imageAlpha =
            if (isSelected) SELECTED_SURFACE_ALPHA else 255

        val labelColor = theme.value(theme.text)

        row.findViewById<ImageView>(R.id.option_icon).apply {
            setImageResource(option.iconRes)
            setColorFilter(if (isSelected) theme.value(theme.accent) else theme.value(theme.textDim))
        }

        row.findViewById<TextView>(R.id.option_title).apply {
            setText(option.titleRes)
            setTextColor(labelColor)
        }

        row.findViewById<TextView>(R.id.option_description).apply {
            setText(option.descriptionRes)
            setTextColor(theme.value(theme.textDim))
        }

        row.findViewById<ImageView>(R.id.option_check).apply {
            visibility = if (isSelected) View.VISIBLE else View.INVISIBLE
            setColorFilter(theme.value(theme.accent))
        }

        row.setOnClickListener { select(option.view) }

        return row
    }

    private fun select(view: CalendarWidgetView) {
        CalendarWidgetSettings.setView(this, widgetId, view)

        WidgetWork.execute {
            CalendarWidgetProvider.render(
                applicationContext,
                AppWidgetManager.getInstance(applicationContext),
                widgetId,
            )
        }

        setResult(RESULT_OK, resultIntent())
        finish()
    }

    private fun resultIntent() = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)

    private companion object {
        val SCRIM_COLOR = Color.argb(150, 0, 0, 0)

        // The selected row is the accent colour at low opacity, not a solid fill.
        const val SELECTED_SURFACE_ALPHA = 56
    }
}
