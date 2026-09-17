package app.prism.assistant

import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

class CapturePermissionActivity : ComponentActivity() {

    private val captureLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val intent = Intent(this, FloatingService::class.java)
        if (result.resultCode == RESULT_OK && result.data != null) {
            intent.action = FloatingService.ACTION_PROJECTION_GRANTED
            intent.putExtra(FloatingService.EXTRA_RESULT_CODE, result.resultCode)
            intent.putExtra(FloatingService.EXTRA_RESULT_DATA, result.data)
        } else {
            intent.action = FloatingService.ACTION_CAPTURE_DENIED
        }
        startService(intent)
        finish()
        overridePendingTransition(0, 0)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) {
            val mpm = getSystemService(MediaProjectionManager::class.java)
            captureLauncher.launch(mpm.createScreenCaptureIntent())
        }
    }
}
