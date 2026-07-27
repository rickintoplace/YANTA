package page.yanta.app.widgets

import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * Single background thread for widget rendering.
 *
 * Serial on purpose: widget updates arrive in bursts (a data sync touching
 * every instance, a resize, a date rollover) and running them one after
 * another keeps the JSON parse cache warm and the CPU cost predictable.
 */
internal object WidgetWork {

    private val executor: Executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "yanta-widgets").apply { isDaemon = true }
    }

    fun execute(block: () -> Unit) {
        executor.execute {
            runCatching(block).onFailure {
                android.util.Log.w("YANTA-Widgets", "Widget update failed", it)
            }
        }
    }
}
