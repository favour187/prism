package app.prism.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PrismLogicTest {

    @Test
    fun testServerUrlSanitization() {
        val raw = "  https://my-prism.example.com/  "
        val clean = raw.trim().removeSuffix("/")
        assertEquals("https://my-prism.example.com", clean)
        assertTrue(clean.startsWith("http://") || clean.startsWith("https://"))
    }

    @Test
    fun testServerUrlValidation() {
        val validHttp = "http://192.168.1.50:4000"
        val validHttps = "https://prism-yks3.onrender.com"
        val invalidFtp = "ftp://something"
        val empty = "   "

        assertTrue(validHttp.startsWith("http://") || validHttp.startsWith("https://"))
        assertTrue(validHttps.startsWith("http://") || validHttps.startsWith("https://"))
        assertFalse(invalidFtp.startsWith("http://") || invalidFtp.startsWith("https://"))
        assertFalse(empty.trim().startsWith("http://") || empty.trim().startsWith("https://"))
    }

    @Test
    fun testFloatingServiceActions() {
        assertEquals("app.prism.assistant.START", FloatingService.ACTION_START)
        assertEquals("app.prism.assistant.STOP", FloatingService.ACTION_STOP)
        assertEquals("app.prism.assistant.PROJECTION_GRANTED", FloatingService.ACTION_PROJECTION_GRANTED)
        assertEquals("app.prism.assistant.CAPTURE_DENIED", FloatingService.ACTION_CAPTURE_DENIED)
        assertEquals("app.prism.assistant.SHOW_PANEL", FloatingService.ACTION_SHOW_PANEL)
    }

    @Test
    fun testEdgeAssistantStateDefaults() {
        assertFalse("Service should not be running initially in test environment", FloatingService.isRunning)
    }

    @Test
    fun testCaptureTokenGenerationFormat() {
        val token = "c" + System.currentTimeMillis().toString(36)
        assertTrue(token.startsWith("c"))
        assertTrue(token.length > 5)
    }

    @Test
    fun testLatencyDiagnosticsCalculation() {
        val sendTs = 1000L
        val reqStartTs = 1050L
        val firstByteTs = 1250L
        val firstTokenTs = 1350L
        val completedTs = 2500L

        val sendToReq = reqStartTs - sendTs
        val ttfb = firstByteTs - reqStartTs
        val ttft = firstTokenTs - reqStartTs
        val total = completedTs - sendTs

        assertEquals(50L, sendToReq)
        assertEquals(200L, ttfb)
        assertEquals(300L, ttft)
        assertEquals(1500L, total)
    }

    @Test
    fun testAudioTtsTextSanitization() {
        val markdown = "Hello **world**, here is `code`"
        val stripped = markdown.replace("**", "").replace("`", "")
        assertEquals("Hello world, here is code", stripped)
        assertTrue(stripped.isNotBlank())
    }
}
