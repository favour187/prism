package app.prism.assistant

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : Activity() {

    private lateinit var overlayBtn: Button
    private lateinit var startBtn: Button
    private lateinit var serverField: EditText

    private val prefs by lazy { getSharedPreferences("prism", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val accent = Color.parseColor("#7C6CFF")
        val dim = Color.parseColor("#9AA3B8")
        val fieldBg = Color.parseColor("#1C2130")

        fun TextView.sub(size: Float = 13f, color: Int = dim) = apply {
            setTextColor(color)
            textSize = size
        }

        val pad = dp(24)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, dp(56), pad, pad)
            setBackgroundColor(Color.parseColor("#0E1016"))
        }

        root.addView(TextView(this).apply {
            text = "◮  Prism"
            setTextColor(Color.WHITE)
            textSize = 30f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })
        root.addView(TextView(this).sub(14f).apply {
            text = "Your AI screen & code assistant, floating over everything.\n\nGrant display-over-apps access, then start the assistant. A small bubble appears over your other apps — tap it to open the panel, capture your screen (one frame per tap, never recording), and get answers right there."
            setPadding(0, dp(10), 0, dp(18))
            setLineSpacing(0f, 1.22f)
        })

        root.addView(TextView(this).sub(12f, Color.WHITE).apply { text = "Prism server" })
        serverField = EditText(this).apply {
            setText(prefs.getString("server", FloatingService.DEFAULT_SERVER))
            setSingleLine()
            setTextColor(Color.WHITE)
            setHintTextColor(dim)
            setPadding(dp(12), 0, dp(12), 0)
            setBackgroundColor(fieldBg)
            inputType = android.text.InputType.TYPE_TEXT_VARIATION_URI
        }
        root.addView(serverField, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)).apply { topMargin = dp(6); bottomMargin = dp(16) })

        overlayBtn = Button(this).apply {
            text = "①  Allow “display over other apps”"
            setBackgroundColor(fieldBg)
            setTextColor(Color.WHITE)
        }
        overlayBtn.setOnClickListener {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        root.addView(overlayBtn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(10) })

        startBtn = Button(this).apply {
            text = "②  Start floating assistant"
            setBackgroundColor(accent)
            setTextColor(Color.WHITE)
        }
        startBtn.setOnClickListener { startAssistant() }
        root.addView(startBtn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16) })

        root.addView(TextView(this).sub(11.5f).apply {
            text = "Privacy: the screen is captured only when YOU tap a capture button — one frame, immediately processed. Enable “Appear on top” shows the bubble; nothing is monitored or recorded in the background."
            setLineSpacing(0f, 1.25f)
        })

        val scroll = ScrollView(this)
        scroll.addView(root)
        setContentView(scroll)

        val needed = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) needed.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), 42)
        }
    }

    override fun onResume() {
        super.onResume()
        val canOverlay = Settings.canDrawOverlays(this)
        overlayBtn.apply {
            text = if (canOverlay) "✓ Display-over-apps permission granted" else "①  Allow “display over other apps”"
            isEnabled = !canOverlay
            alpha = if (canOverlay) 0.6f else 1f
        }
    }

    private fun startAssistant() {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Grant display-over-apps permission first", Toast.LENGTH_LONG).show()
            return
        }
        val url = serverField.text.toString().trim().removeSuffix("/")
        if (!url.startsWith("http")) {
            Toast.makeText(this, "Enter a valid server URL", Toast.LENGTH_LONG).show()
            return
        }
        prefs.edit().putString("server", url).apply()
        ContextCompat.startForegroundService(
            this,
            Intent(this, FloatingService::class.java).setAction(FloatingService.ACTION_START),
        )
        finish()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
