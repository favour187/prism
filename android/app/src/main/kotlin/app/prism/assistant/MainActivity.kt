package app.prism.assistant

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : Activity() {

    private lateinit var container: FrameLayout
    private var webView: WebView? = null

    private val prefs by lazy { getSharedPreferences("prism", MODE_PRIVATE) }

    private val serverUrl: String
        get() = prefs.getString("server", FloatingService.DEFAULT_SERVER) ?: FloatingService.DEFAULT_SERVER

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        container = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#0E1016"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        setContentView(container)

        initWebView()
        requestAppPermissions()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun initWebView() {
        if (webView != null) return

        val wv = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0E1016"))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_DEFAULT
                useWideViewPort = true
                loadWithOverviewMode = true
                textZoom = 100
            }

            addJavascriptInterface(MainAppJsBridge(this@MainActivity), "prismAndroid")

            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    val wantsAudio = request.resources.any { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                    val osGranted = ContextCompat.checkSelfPermission(
                        this@MainActivity,
                        Manifest.permission.RECORD_AUDIO,
                    ) == PackageManager.PERMISSION_GRANTED

                    runOnUiThread {
                        if (wantsAudio && osGranted) {
                            request.grant(request.resources)
                        } else if (wantsAudio && !osGranted) {
                            ActivityCompat.requestPermissions(
                                this@MainActivity,
                                arrayOf(Manifest.permission.RECORD_AUDIO),
                                101,
                            )
                            request.deny()
                        } else {
                            request.deny()
                        }
                    }
                }
            }

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                    return if (url.startsWith(serverUrl) || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) {
                        false
                    } else {
                        runCatching {
                            view.context.startActivity(
                                Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            )
                        }
                        true
                    }
                }
            }

            loadUrl("$serverUrl/?android=1")
        }

        webView = wv
        container.addView(
            wv,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
    }

    private fun requestAppPermissions() {
        val needed = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.RECORD_AUDIO)
        }
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), 42)
        }
    }

    fun startEdgeAssistant(): Boolean {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Allow \"Display over other apps\" to use Edge Assistant", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            return false
        }
        ContextCompat.startForegroundService(
            this,
            Intent(this, FloatingService::class.java).setAction(FloatingService.ACTION_START),
        )
        Toast.makeText(this, "Edge Assistant started — thin handle active at screen edge", Toast.LENGTH_SHORT).show()
        return true
    }

    fun stopEdgeAssistant() {
        startService(Intent(this, FloatingService::class.java).setAction(FloatingService.ACTION_STOP))
        Toast.makeText(this, "Edge Assistant disabled", Toast.LENGTH_SHORT).show()
    }

    fun isEdgeAssistantRunning(): Boolean {
        return FloatingService.isRunning
    }

    override fun onBackPressed() {
        val wv = webView
        if (wv != null && wv.canGoBack()) {
            wv.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        container.removeAllViews()
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}

class MainAppJsBridge(private val activity: MainActivity) {

    @android.webkit.JavascriptInterface
    fun getPlatform(): String = "android"

    @android.webkit.JavascriptInterface
    fun startEdgeAssistant(): Boolean {
        var result = false
        activity.runOnUiThread {
            result = activity.startEdgeAssistant()
        }
        return result
    }

    @android.webkit.JavascriptInterface
    fun stopEdgeAssistant() {
        activity.runOnUiThread {
            activity.stopEdgeAssistant()
        }
    }

    @android.webkit.JavascriptInterface
    fun isEdgeRunning(): Boolean {
        return activity.isEdgeAssistantRunning()
    }
}
