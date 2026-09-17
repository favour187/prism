package app.prism.assistant

import android.Manifest
import android.app.Activity
import android.content.Context
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
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : Activity() {

    private lateinit var overlayBtn: Button
    private lateinit var statusText: TextView
    private lateinit var spinnerRow: LinearLayout
    private lateinit var serverField: EditText
    private lateinit var saveBtn: Button

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
            text = "Chat-first screen assistant. Prism opens straight into its answer panel; a thin line sits at the screen edge so you can reopen it anytime. Tap a capture button and answers arrive in seconds — one frame per tap, never recorded."
            setPadding(0, dp(10), 0, dp(18))
            setLineSpacing(0f, 1.22f)
        })

        root.addView(TextView(this).sub(12f, Color.WHITE).apply { text = "Status" })
        statusText = TextView(this).sub(13f).apply {
            text = "Checking…"
            setPadding(0, dp(6), 0, dp(2))
        }
        root.addView(statusText)

        val spinner = ProgressBar(this).apply {
            indeterminateTintList = android.content.res.ColorStateList.valueOf(accent)
        }
        spinnerRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(4), 0, dp(4))
        }
        spinnerRow.addView(spinner, LinearLayout.LayoutParams(dp(18), dp(18)).apply { rightMargin = dp(10) })
        spinnerRow.addView(TextView(this).sub(13f).apply { text = "Waking the assistant…" })
        root.addView(spinnerRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4) })

        overlayBtn = Button(this).apply {
            text = "Allow “display over other apps”"
            setBackgroundColor(fieldBg)
            setTextColor(Color.WHITE)
        }
        overlayBtn.setOnClickListener {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        root.addView(overlayBtn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12); bottomMargin = dp(6) })

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
        root.addView(serverField, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)).apply { topMargin = dp(6); bottomMargin = dp(8) })

        saveBtn = Button(this).apply {
            text = "Save server"
            setBackgroundColor(accent)
            setTextColor(Color.WHITE)
        }
        saveBtn.setOnClickListener {
            val url = serverField.text.toString().trim().removeSuffix("/")
            if (!url.startsWith("http")) {
                Toast.makeText(this, "Enter a valid server URL", Toast.LENGTH_LONG).show()
            } else {
                prefs.edit().putString("server", url).apply()
                Toast.makeText(this, "Server saved — reopening assistant", Toast.LENGTH_SHORT).show()
                launchAssistant()
            }
        }
        root.addView(saveBtn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16) })

        root.addView(TextView(this).sub(11.5f).apply {
            text = "Privacy: the screen is captured only when YOU tap a capture button — one frame, immediately processed. The thin edge line stays quiet until tapped; nothing is monitored or recorded in the background."
            setLineSpacing(0f, 1.25f)
        })

        setContentView(root)

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
        val server = prefs.getString("server", FloatingService.DEFAULT_SERVER)
        val ready = canOverlay && isValidServer(server)
        overlayBtn.apply {
            text = if (canOverlay) "✓ Display-over-apps permission granted" else "Allow “display over other apps”"
            isEnabled = !canOverlay
            alpha = if (canOverlay) 0.6f else 1f
        }
        statusText.text = when {
            !canOverlay -> "Next: allow display-over-apps, then the assistant wakes itself."
            !isValidServer(server) -> "Server URL looks invalid — fix it below."
            else -> "Assistant will open right now."
        }
        spinnerRow.visibility = if (canOverlay) View.GONE else View.VISIBLE
        if (ready) launchAssistant()
    }

    private fun launchAssistant() {
        if (!Settings.canDrawOverlays(this)) return
        val url = prefs.getString("server", FloatingService.DEFAULT_SERVER).orEmpty().trim().removeSuffix("/")
        if (!url.startsWith("http")) return
        prefs.edit().putString("server", url).apply()
        ContextCompat.startForegroundService(
            this,
            Intent(this, FloatingService::class.java).setAction(FloatingService.ACTION_START),
        )
        finish()
    }

    private fun isValidServer(url: String?): Boolean = url?.trim().orEmpty().startsWith("http")

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
