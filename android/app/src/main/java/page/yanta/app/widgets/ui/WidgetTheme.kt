package page.yanta.app.widgets.ui

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import androidx.core.content.ContextCompat
import page.yanta.app.R

/**
 * A colour with a value for each of the launcher's night modes.
 *
 * Widgets are drawn in the launcher's process from a recorded list of
 * actions, so a colour baked in as a plain int stays whatever it was when
 * the widget was last updated. Carrying both values lets the widget follow
 * a system theme toggle immediately — see [page.yanta.app.widgets.render]'s
 * themed setters.
 */
data class WidgetColor(val light: Int, val dark: Int) {
    fun resolve(isDark: Boolean): Int = if (isDark) dark else light

    companion object {
        /** A colour the user's explicit theme choice pins in both modes. */
        fun fixed(value: Int) = WidgetColor(value, value)
    }
}

/**
 * The YANTA palette for one widget draw.
 *
 * Honours the app's own theme setting (`auto` | `dark` | `light`) rather
 * than only the system one: a user who forces light mode in YANTA gets
 * light widgets on a dark home screen. Only `auto` defers to the launcher.
 */
class WidgetTheme private constructor(
    val background: WidgetColor,
    val surface: WidgetColor,
    val border: WidgetColor,
    val text: WidgetColor,
    val textDim: WidgetColor,
    val textFaint: WidgetColor,
    val accent: WidgetColor,
    val onAccent: Int,
    val isDark: Boolean,
    /** False once the user pinned a theme, so both values are identical. */
    val followsSystem: Boolean,
) {

    /** Resolved for the app's own UI, where a plain colour is needed. */
    fun value(color: WidgetColor): Int = color.resolve(isDark)

    /** Same contrast rule the web layer uses for event chip labels. */
    fun readableTextOn(background: Int): Int =
        if (relativeLuminance(background) > 0.55) Color.BLACK else Color.WHITE

    companion object {

        fun resolve(context: Context, appTheme: String): WidgetTheme {
            val followsSystem = appTheme != "dark" && appTheme != "light"
            val isDark = when (appTheme) {
                "dark" -> true
                "light" -> false
                else -> systemPrefersDark(context)
            }

            fun color(lightRes: Int, darkRes: Int): WidgetColor =
                if (followsSystem) {
                    WidgetColor(
                        light = ContextCompat.getColor(context, lightRes),
                        dark = ContextCompat.getColor(context, darkRes),
                    )
                } else {
                    WidgetColor.fixed(
                        ContextCompat.getColor(context, if (isDark) darkRes else lightRes)
                    )
                }

            return WidgetTheme(
                background = color(R.color.widget_light_bg, R.color.widget_dark_bg),
                surface = color(R.color.widget_light_surface, R.color.widget_dark_surface),
                border = color(R.color.widget_light_border, R.color.widget_dark_border),
                text = color(R.color.widget_light_text, R.color.widget_dark_text),
                textDim = color(R.color.widget_light_text_dim, R.color.widget_dark_text_dim),
                textFaint = color(
                    R.color.widget_light_text_faint,
                    R.color.widget_dark_text_faint,
                ),
                accent = color(R.color.widget_light_accent, R.color.widget_dark_accent),
                onAccent = Color.WHITE,
                isDark = isDark,
                followsSystem = followsSystem,
            )
        }

        private fun systemPrefersDark(context: Context): Boolean =
            context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
                Configuration.UI_MODE_NIGHT_YES

        private fun relativeLuminance(color: Int): Double {
            fun channel(value: Int): Double {
                val v = value / 255.0
                return if (v <= 0.03928) v / 12.92 else Math.pow((v + 0.055) / 1.055, 2.4)
            }

            return 0.2126 * channel(Color.red(color)) +
                0.7152 * channel(Color.green(color)) +
                0.0722 * channel(Color.blue(color))
        }
    }
}
