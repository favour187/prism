package app.prism.assistant

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Base64
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.content.pm.PackageManager
import android.Manifest
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.core.content.ContextCompat
import android.widget.ImageView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.io.ByteArrayOutputStream
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

class FloatingService : Service() {

    companion object {
        const val ACTION_START = "app.prism.assistant.START"
        const val ACTION_STOP = "app.prism.assistant.STOP"
        const val ACTION_PROJECTION_GRANTED = "app.prism.assistant.PROJECTION_GRANTED"
        const val ACTION_CAPTURE_DENIED = "app.prism.assistant.CAPTURE_DENIED"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val ACTION_SHOW_PANEL = "app.prism.assistant.SHOW_PANEL"

        const val DEFAULT_SERVER = "https://prism-yks3.onrender.com"
        private const val NOTIF_ID = 101
        private const val CHANNEL_ID = "prism"
        private const val CAPTURE_TIMEOUT_MS = 9_000L
    }

    private lateinit var wm: WindowManager
    private lateinit var projectionManager: MediaProjectionManager
    private val mainHandler by lazy { Handler(mainLooper) }
    private val captureThread = HandlerThread("prism-capture").apply { start() }
    private val captureHandler by lazy { Handler(captureThread.looper) }

    private var bubble: View? = null
    private var bubbleParams: WindowManager.LayoutParams? = null
    private var panel: FrameLayout? = null
    private var panelParams: WindowManager.LayoutParams? = null
    private var panelVisible = false

    private var webView: WebView? = null

    private var pendingToken: String? = null
    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var captureDone = false
    private val timeoutRunnable = Runnable { finishCapture(null, timedOut = true) }

    private val serverUrl: String
        get() = getSharedPreferences("prism", MODE_PRIVATE).getString("server", DEFAULT_SERVER) ?: DEFAULT_SERVER

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        createChannel()
        goForeground(SpecialUse)
        ensureBubble()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopSelf()
            ACTION_SHOW_PANEL -> showPanel(true)
            ACTION_CAPTURE_DENIED -> {
                mainHandler.post { evaluateCaptureResult(token = pendingToken, dataUrl = null) }
                pendingToken = null
                showPanel(true)
            }
            ACTION_PROJECTION_GRANTED -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                val data: Intent? = if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_RESULT_DATA)
                }
                if (data != null) beginCapture(resultCode, data) else onCaptureFailed()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        teardownCapture()
        removeViews()
        webView?.destroy()
        captureThread.quitSafely()
        super.onDestroy()
    }

    private object SpecialUse
    private object MediaProj

    private fun goForeground(kind: Any) {
        val type = when (kind) {
            SpecialUse -> ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            else -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        }
        if (Build.VERSION.SDK_INT >= 29) {
            ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(), type)
        } else {
            startForeground(NOTIF_ID, buildNotification())
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.channel_name),
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = getString(R.string.channel_desc) }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, FloatingService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_prism)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text))
            .setContentIntent(openApp)
            .setOngoing(true)
            .addAction(0, "Stop", stop)
            .build()
    }


    @SuppressLint("ClickableViewAccessibility")
    private fun ensureBubble() {
        if (bubble != null) return
        val size = dp(56)
        val view = ImageView(this).apply {
            setImageResource(R.drawable.bubble_bg)
            contentDescription = "Prism assistant"
        }
        val overlayType =
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val params = WindowManager.LayoutParams(
            size, size,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            val (sw, sh) = displaySize().let { it.first to it.second }
            x = sw - size - dp(12)
            y = (sh * 0.35f).toInt()
        }
        var downX = 0f; var downY = 0f
        var startX = 0; var startY = 0
        var dragged = false
        view.setOnTouchListener { v, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY
                    startX = params.x; startY = params.y
                    dragged = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (e.rawX - downX).toInt(); val dy = (e.rawY - downY).toInt()
                    if (abs(dx) > 8 || abs(dy) > 8) dragged = true
                    if (dragged) {
                        params.x = startX + dx; params.y = startY + dy
                        runCatching { wm.updateViewLayout(v, params) }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!dragged) togglePanel()
                    true
                }
                else -> false
            }
        }
        wm.addView(view, params)
        bubble = view
        bubbleParams = params
    }


    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun ensurePanel() {
        if (panel != null) return
        val container = FrameLayout(this)

        val wv = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = false
            addJavascriptInterface(PrismJsBridge(this@FloatingService), "prismAndroid")
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    val wantsAudio = request.resources.any { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                    val osGranted = ContextCompat.checkSelfPermission(
                        this@FloatingService, Manifest.permission.RECORD_AUDIO,
                    ) == PackageManager.PERMISSION_GRANTED
                    mainHandler.post {
                        if (wantsAudio && osGranted) request.grant(request.resources) else request.deny()
                    }
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                    return if (url.startsWith(serverUrl) || url.startsWith("data:") || url.startsWith("blob:")) {
                        false
                    } else {
                        runCatching { view.context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        true
                    }
                }
            }
            loadUrl("$serverUrl/?overlay=1&android=1")
        }
        webView = wv
        container.addView(wv, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        container.setOnTouchListener { _, e ->
            if (e.action == MotionEvent.ACTION_OUTSIDE) { showPanel(false); true } else false
        }

        val overlayType =
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val (sw, sh) = displaySize()
        val width = minOf((sw * 0.94f).toInt(), dp(520))
        val height = (sh * 0.72f).toInt()
        panelParams = WindowManager.LayoutParams(
            width, height,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (sw - width) / 2
            y = (sh * 0.05f).toInt()
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or
                WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN
        }
        panel = container
    }

    fun togglePanel() = showPanel(!panelVisible)

    fun showPanel(show: Boolean) {
        mainHandler.post {
            ensurePanel()
            val p = panel ?: return@post
            if (show && !panelVisible) {
                runCatching { wm.addView(p, panelParams) }
                panelVisible = true
            } else if (!show && panelVisible) {
                runCatching { wm.removeView(p) }
                panelVisible = false
            }
        }
    }

    fun hidePanelForCapture() = showPanel(false)


    fun requestCapture(kind: String, token: String) {
        mainHandler.post {
            if (pendingToken != null) {
                evaluateCaptureResult(token, null)
                return@post
            }
            pendingToken = token
            mainHandler.removeCallbacks(timeoutRunnable)
            mainHandler.postDelayed(timeoutRunnable, CAPTURE_TIMEOUT_MS)
            showPanel(false)
            startActivity(
                Intent(this, CapturePermissionActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }

    private fun beginCapture(resultCode: Int, data: Intent) {
        goForeground(MediaProj)
        captureDone = false
        try {
            val mp = projectionManager.getMediaProjection(resultCode, data)
            projection = mp
            if (Build.VERSION.SDK_INT >= 34) {
                mp.registerCallback(object : MediaProjection.Callback() {
                    override fun onStop() {
                        if (!captureDone) finishCapture(null, timedOut = false)
                    }
                }, captureHandler)
            }
            val (w, h, densityDpi) = displaySize(withDpi = true)
            val cappedW: Int
            val cappedH: Int
            if (maxOf(w, h) > 1920) {
                val scaleDown = 1920f / maxOf(w, h).toFloat()
                cappedW = (w * scaleDown).roundToInt()
                cappedH = (h * scaleDown).roundToInt()
            } else { cappedW = w; cappedH = h }

            val reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
            imageReader = reader
            reader.setOnImageAvailableListener({ r ->
                if (captureDone) return@setOnImageAvailableListener
                val image = try { r.acquireLatestImage() } catch (_: Exception) { null }
                val bmp = image?.let { imageToBitmap(it, cappedW, cappedH) }
                image?.close()
                finishCapture(bmp, timedOut = false)
            }, captureHandler)

            virtualDisplay = mp.createVirtualDisplay(
                "prism", w, h, densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                reader.surface, null, captureHandler,
            )
        } catch (e: Exception) {
            onCaptureFailed()
        }
    }

    private fun imageToBitmap(image: android.media.Image, outW: Int, outH: Int): Bitmap? {
        return try {
            val plane = image.planes[0]
            val buffer = plane.buffer
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val rowPadding = rowStride - pixelStride * image.width
            val paddedWidth = image.width + rowPadding / pixelStride
            var bitmap = Bitmap.createBitmap(paddedWidth, image.height, Bitmap.Config.ARGB_8888)
            bitmap.copyPixelsFromBuffer(buffer)
            if (rowPadding != 0) bitmap = Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height)
            if (bitmap.width != outW || bitmap.height != outH) {
                bitmap = Bitmap.createScaledBitmap(bitmap, outW, outH, true)
            }
            bitmap
        } catch (_: Exception) {
            null
        }
    }

    private fun finishCapture(bitmap: Bitmap?, timedOut: Boolean) {
        if (captureDone) return
        captureDone = true
        val token = pendingToken
        pendingToken = null
        mainHandler.removeCallbacks(timeoutRunnable)
        teardownCapture()
        mainHandler.post {
            evaluateCaptureResult(token, bitmap?.toPngDataUrl())
            showPanel(true)
            goForeground(SpecialUse)
        }
    }

    private fun onCaptureFailed() {
        val token = pendingToken
        pendingToken = null
        mainHandler.removeCallbacks(timeoutRunnable)
        teardownCapture()
        mainHandler.post {
            evaluateCaptureResult(token, null)
            showPanel(true)
        }
    }

    private fun evaluateCaptureResult(token: String?, dataUrl: String?) {
        if (token == null) return
        webView?.evaluateJavascript("window.__prismCaptureResult && window.__prismCaptureResult('$token','${dataUrl ?: ""}')", null)
    }

    private fun teardownCapture() {
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        projection?.stop()
        projection = null
    }

    private fun removeViews() {
        bubble?.let { runCatching { wm.removeView(it) } }
        bubble = null
        if (panelVisible) panel?.let { runCatching { wm.removeView(it) } }
        panelVisible = false
    }


    @Suppress("DEPRECATION")
    private fun displaySize(withDpi: Boolean = false): Triple<Int, Int, Int> {
        return if (Build.VERSION.SDK_INT >= 30) {
            val metrics = wm.currentWindowMetrics
            val b = metrics.bounds
            Triple(
                b.width(),
                b.height(),
                resources.displayMetrics.densityDpi.takeIf { withDpi } ?: 0,
            )
        } else {
            val dm = DisplayMetrics()
            wm.defaultDisplay.getRealMetrics(dm)
            Triple(dm.widthPixels, dm.heightPixels, dm.densityDpi.takeIf { withDpi } ?: 0)
        }
    }

    private fun Bitmap.toPngDataUrl(): String {
        val out = ByteArrayOutputStream()
        compress(Bitmap.CompressFormat.PNG, 100, out)
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).roundToInt()
}

class PrismJsBridge(private val service: FloatingService) {

    @android.webkit.JavascriptInterface
    fun requestCapture(kind: String, token: String) = service.requestCapture(kind, token)

    @android.webkit.JavascriptInterface
    fun getPlatform(): String = "android"

    @android.webkit.JavascriptInterface
    fun showPanel() = service.showPanel(true)

    @android.webkit.JavascriptInterface
    fun hidePanel() = service.showPanel(false)
}
