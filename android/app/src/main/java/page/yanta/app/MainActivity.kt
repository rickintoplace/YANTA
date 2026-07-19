package page.yanta.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.content.Intent
import android.content.pm.PackageManager
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.updatePadding
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import page.yanta.app.bridge.YantaJsBridge
import page.yanta.app.notifications.ChatNotifier
import page.yanta.app.notifications.NotificationScheduler
import page.yanta.app.push.PushTokenStore
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : ComponentActivity() {

    private lateinit var root: FrameLayout
    private lateinit var webView: WebView

    private var pendingNativeAction: String? = null
    private var pageLoaded = false

    // WebRTC/getUserMedia permission request waiting for the runtime grant.
    private var pendingWebPermissionRequest: PermissionRequest? = null

    // <input type="file"> / gallery picker callback.
    private var pendingFilePathCallback: ValueCallback<Array<Uri>>? = null

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            dispatchNotificationStatus()
        }

    private val mediaPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            val request = pendingWebPermissionRequest
            pendingWebPermissionRequest = null

            if (request == null) return@registerForActivityResult

            val requestedResources = request.resources.toSet()
            val grantedResources = mutableListOf<String>()

            if (
                PermissionRequest.RESOURCE_AUDIO_CAPTURE in requestedResources &&
                isMicrophoneGranted()
            ) {
                grantedResources += PermissionRequest.RESOURCE_AUDIO_CAPTURE
            }

            if (
                PermissionRequest.RESOURCE_VIDEO_CAPTURE in requestedResources &&
                isCameraGranted()
            ) {
                grantedResources += PermissionRequest.RESOURCE_VIDEO_CAPTURE
            }

            val supportedResources = setOf(
                PermissionRequest.RESOURCE_AUDIO_CAPTURE,
                PermissionRequest.RESOURCE_VIDEO_CAPTURE
            )

            val hasUnsupportedResources = requestedResources.any { it !in supportedResources }
            val allRequestedGranted = requestedResources.all { it in grantedResources }

            if (!hasUnsupportedResources && allRequestedGranted) {
                request.grant(grantedResources.toTypedArray())
            } else {
                request.deny()
            }
        }

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = pendingFilePathCallback
            pendingFilePathCallback = null
            callback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            )
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        configureEdgeToEdgeWindow()
        ChatNotifier.ensureChannel(this)

        root = FrameLayout(this).apply {
            setBackgroundColor(DEFAULT_SYSTEM_BAR_COLOR)
            clipToPadding = false
        }
        webView = WebView(this).apply {
            setBackgroundColor(DEFAULT_SYSTEM_BAR_COLOR)
            overScrollMode = WebView.OVER_SCROLL_NEVER
        }
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(root)
        installSafeAreaInsets(root)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            /*
             * Chat voice messages: recorded audio previews must be playable
             * right after recording without an extra tap.
             */
            mediaPlaybackRequiresUserGesture = false
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(webView.settings, WebSettingsCompat.FORCE_DARK_AUTO)
        }

        webView.webChromeClient = createChromeClient()

        webView.addJavascriptInterface(
            YantaJsBridge(
                activity = this,
                webView = webView,
                onRequestNotificationPermission = { requestNotificationPermission() },
                onOpenNotificationSettings = { openNotificationSettings() },
                onOpenExactAlarmSettings = { openExactAlarmSettings() },
            ),
            "YantaAndroid"
        )

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean = handleUri(request.url, fromWebView = true)

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                pageLoaded = url?.startsWith(BuildConfig.YANTA_URL) == true
                installAndroidSystemBarThemeSync()
                dispatchNotificationStatus()
                dispatchPushTokenIfChanged()
                pendingNativeAction?.let { action ->
                    pendingNativeAction = null
                    dispatchQuickAction(action)
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        // Ensure an FCM token exists even before the first onNewToken callback.
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token -> PushTokenStore.saveToken(this, token) }

        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        NotificationScheduler.rescheduleFromStore(this)
        dispatchNotificationStatus()
        dispatchPushTokenIfChanged()
        // Token rotations while the app is open reach the web layer immediately.
        PushTokenStore.onTokenChanged = { _ ->
            webView.post { dispatchPushTokenIfChanged() }
        }
    }

    override fun onPause() {
        super.onPause()
        PushTokenStore.onTokenChanged = null
    }

    // ------------------------------------------------------------
    // WebChromeClient: microphone + gallery/file picker
    // ------------------------------------------------------------

    private fun createChromeClient(): WebChromeClient = object : WebChromeClient() {

        /** getUserMedia (voice messages). Only trusted YANTA origins are granted. */
        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread {
                if (!isTrustedOrigin(request.origin)) {
                    request.deny()
                    return@runOnUiThread
                }

                val requestedResources = request.resources.toSet()

                val supportedResources = setOf(
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE,
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE
                )

                if (requestedResources.isEmpty() || requestedResources.any { it !in supportedResources }) {
                    request.deny()
                    return@runOnUiThread
                }

                val missingAndroidPermissions = mutableListOf<String>()
                val grantResources = mutableListOf<String>()

                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in requestedResources) {
                    if (isMicrophoneGranted()) {
                        grantResources += PermissionRequest.RESOURCE_AUDIO_CAPTURE
                    } else {
                        missingAndroidPermissions += Manifest.permission.RECORD_AUDIO
                    }
                }

                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in requestedResources) {
                    if (isCameraGranted()) {
                        grantResources += PermissionRequest.RESOURCE_VIDEO_CAPTURE
                    } else {
                        missingAndroidPermissions += Manifest.permission.CAMERA
                    }
                }

                if (missingAndroidPermissions.isEmpty()) {
                    request.grant(grantResources.toTypedArray())
                } else {
                    pendingWebPermissionRequest?.deny()
                    pendingWebPermissionRequest = request
                    mediaPermissionLauncher.launch(missingAndroidPermissions.toTypedArray())
                }
            }
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (pendingWebPermissionRequest == request) {
                pendingWebPermissionRequest = null
            }
        }

        /**
         * <input type="file"> → system photo picker / documents UI.
         * No storage permission needed on API 29+.
         */
        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams
        ): Boolean {
            pendingFilePathCallback?.onReceiveValue(null)
            pendingFilePathCallback = filePathCallback
            val intent = try {
                fileChooserParams.createIntent().apply {
                    if (fileChooserParams.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                    addCategory(Intent.CATEGORY_OPENABLE)
                }
            } catch (_: Throwable) {
                Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
            }
            return try {
                fileChooserLauncher.launch(intent)
                true
            } catch (_: Throwable) {
                pendingFilePathCallback = null
                filePathCallback.onReceiveValue(null)
                false
            }
        }
    }

    private fun isTrustedOrigin(origin: Uri?): Boolean {
        val yanta = Uri.parse(BuildConfig.YANTA_URL)
        return origin?.scheme == "https" && origin.host == yanta.host
    }

    fun isMicrophoneGranted(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED

    fun isCameraGranted(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
    
    // ------------------------------------------------------------
    // Push token → web
    // ------------------------------------------------------------

    private fun dispatchPushTokenIfChanged() {
        if (!pageLoaded) return
        val token = PushTokenStore.token(this)
        if (token.isBlank() || token == PushTokenStore.lastDispatchedToken(this)) return
        PushTokenStore.markDispatched(this, token)
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('yanta-android-push-token-changed'));",
            null
        )
    }

    // ------------------------------------------------------------
    // Window / insets / theme
    // ------------------------------------------------------------

    private fun configureEdgeToEdgeWindow() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 29) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
        setSystemBarsIconMode(useDarkIcons = false)
    }

    private fun installSafeAreaInsets(target: FrameLayout) {
        ViewCompat.setOnApplyWindowInsetsListener(target) { view, insets ->
            val systemBars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                        WindowInsetsCompat.Type.displayCutout()
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
            view.updatePadding(
                left = systemBars.left,
                top = systemBars.top,
                right = systemBars.right,
                bottom = if (imeVisible) maxOf(systemBars.bottom, ime.bottom) else systemBars.bottom
            )
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(target)
    }

    fun setSystemBarsAppearance(backgroundColor: String, useDarkIcons: Boolean) {
        val color = parseCssHexColor(backgroundColor) ?: DEFAULT_SYSTEM_BAR_COLOR
        root.setBackgroundColor(color)
        webView.setBackgroundColor(color)
        setSystemBarsIconMode(useDarkIcons)
    }

    private fun setSystemBarsIconMode(useDarkIcons: Boolean) {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = useDarkIcons
            isAppearanceLightNavigationBars = useDarkIcons
        }
    }

    private fun parseCssHexColor(value: String): Int? {
        val color = value.trim()
        if (!HEX_RGB_REGEX.matches(color)) return null
        return runCatching { Color.parseColor(color) }.getOrNull()
    }

    private fun installAndroidSystemBarThemeSync() {
        webView.evaluateJavascript(SYSTEM_BAR_SYNC_JS, null)
    }

    // ------------------------------------------------------------
    // Intents / deep links
    // ------------------------------------------------------------

    private fun handleIntent(intent: Intent) {
        // Chat notification tap: never reload the SPA when it is already running.
        val chatRoomId = intent.getStringExtra(ChatNotifier.EXTRA_CHAT_ROOM_ID)
        if (!chatRoomId.isNullOrBlank()) {
            ChatNotifier.clear(this, chatRoomId)
            if (pageLoaded) {
                dispatchChatNotificationOpen(chatRoomId)
            } else {
                webView.loadUrl("${BuildConfig.YANTA_URL}/#chat/${Uri.encode(chatRoomId)}")
            }
            return
        }

        val uri = intent.data
        if (uri != null && handleUri(uri, fromWebView = false)) return
        if (!pageLoaded) webView.loadUrl(BuildConfig.YANTA_URL)
    }

    private fun dispatchChatNotificationOpen(roomId: String) {
        webView.post {
            webView.evaluateJavascript(
                """
                window.dispatchEvent(new CustomEvent('yanta-android-chat-notification-open', {
                  detail: { roomId: ${JSONObject.quote(roomId)} }
                }));
                """.trimIndent(),
                null
            )
        }
    }

    private fun handleUri(uri: Uri, fromWebView: Boolean): Boolean {
        if (uri.scheme == "https" && uri.host == "yanta.page") {
            /*
             * SPA-friendly deep links: if the app shell already runs, hash-only
             * navigation happens inside the WebView without a reload.
             */
            val fragment = uri.fragment.orEmpty()
            if (!fromWebView && pageLoaded && fragment.startsWith("chat/")) {
                dispatchChatNotificationOpen(Uri.decode(fragment.removePrefix("chat/")))
                return true
            }
            if (fromWebView) return false // let the WebView handle same-host links
            webView.loadUrl(uri.toString())
            return true
        }
        if (uri.scheme == "yanta" && uri.host == "open") {
            val action = uri.getQueryParameter("action") ?: ""
            val targetUrl = when (action) {
                "calendar" -> "${BuildConfig.YANTA_URL}/#calendar"
                else -> BuildConfig.YANTA_URL
            }
            pendingNativeAction = action
            webView.loadUrl(targetUrl)
            return true
        }
        if (fromWebView) {
            // External links open in the browser; never crash on missing handlers.
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            return true
        }
        return false
    }

    // ------------------------------------------------------------
    // Notification status / permissions (unchanged behavior)
    // ------------------------------------------------------------

    fun notificationStatusJson(): String {
        val notificationsGranted =
            Build.VERSION.SDK_INT < 33 ||
                    ContextCompat.checkSelfPermission(
                        this,
                        Manifest.permission.POST_NOTIFICATIONS
                    ) == PackageManager.PERMISSION_GRANTED
        val exactAlarmAllowed =
            if (Build.VERSION.SDK_INT >= 31) {
                getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
            } else true
        return JSONObject()
            .put("isAndroidApp", true)
            .put("notificationsGranted", notificationsGranted)
            .put("exactAlarmAllowed", exactAlarmAllowed)
            .toString()
    }

    fun dispatchNotificationStatus() {
        val json = notificationStatusJson()
        webView.post {
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('yanta-android-notification-status', { detail: $json }));",
                null
            )
        }
    }

    private fun dispatchQuickAction(action: String) {
        webView.postDelayed({
            webView.evaluateJavascript(
                """
                window.dispatchEvent(new CustomEvent('yanta-android-quick-action', {
                  detail: { action: ${JSONObject.quote(action)} }
                }));
                """.trimIndent(),
                null
            )
        }, 600)
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            dispatchNotificationStatus()
        }
    }

    private fun openNotificationSettings() {
        startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        )
    }

    private fun openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT >= 31) {
            startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM))
        }
    }

    companion object {
        private val HEX_RGB_REGEX = Regex("^#[0-9a-fA-F]{6}$")
        private val DEFAULT_SYSTEM_BAR_COLOR = Color.rgb(20, 20, 20)

        // Unchanged theme-sync script, extracted for readability.
        private val SYSTEM_BAR_SYNC_JS = """
            (function () {
              if (window.__yantaAndroidSystemBarSyncInstalled) {
                if (typeof window.__yantaAndroidUpdateSystemBars === 'function') {
                  window.__yantaAndroidUpdateSystemBars();
                }
                return;
              }
              window.__yantaAndroidSystemBarSyncInstalled = true;
              function normalizeColor(value) {
                try {
                  var canvas = normalizeColor._canvas || (normalizeColor._canvas = document.createElement('canvas'));
                  var ctx = canvas.getContext('2d');
                  ctx.fillStyle = '#141414';
                  ctx.fillStyle = String(value || '').trim();
                  var out = String(ctx.fillStyle || '').trim();
                  if (/^#[0-9a-f]{6}${'$'}/i.test(out)) return out;
                  var match = out.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
                  if (!match) return '#141414';
                  function part(n) {
                    return Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, '0');
                  }
                  return '#' + part(match[1]) + part(match[2]) + part(match[3]);
                } catch (_) { return '#141414'; }
              }
              function hexToRgb(hex) {
                var raw = String(hex || '').replace('#', '');
                return {
                  r: parseInt(raw.slice(0, 2), 16) || 0,
                  g: parseInt(raw.slice(2, 4), 16) || 0,
                  b: parseInt(raw.slice(4, 6), 16) || 0
                };
              }
              function relativeLuminance(rgb) {
                function channel(v) {
                  v = v / 255;
                  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
                }
                return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
              }
              var scheduled = false;
              window.__yantaAndroidUpdateSystemBars = function () {
                if (scheduled) return;
                scheduled = true;
                requestAnimationFrame(function () {
                  scheduled = false;
                  try {
                    var rootStyles = getComputedStyle(document.documentElement);
                    var bodyStyles = getComputedStyle(document.body);
                    var bg = rootStyles.getPropertyValue('--bg') || bodyStyles.backgroundColor || '#141414';
                    var color = normalizeColor(bg);
                    var useDarkIcons = relativeLuminance(hexToRgb(color)) > 0.62;
                    if (window.YantaAndroid && typeof window.YantaAndroid.setSystemBarsAppearance === 'function') {
                      window.YantaAndroid.setSystemBarsAppearance(color, useDarkIcons);
                    }
                  } catch (_) {}
                });
              };
              window.addEventListener('yanta-theme-change', window.__yantaAndroidUpdateSystemBars);
              window.addEventListener('pageshow', window.__yantaAndroidUpdateSystemBars);
              try {
                var observer = new MutationObserver(window.__yantaAndroidUpdateSystemBars);
                observer.observe(document.documentElement, {
                  attributes: true,
                  attributeFilter: ['data-theme', 'class', 'style']
                });
                if (document.body) {
                  observer.observe(document.body, {
                    attributes: true,
                    attributeFilter: ['class', 'style']
                  });
                }
              } catch (_) {}
              window.__yantaAndroidUpdateSystemBars();
            })();
        """.trimIndent()
    }
}
