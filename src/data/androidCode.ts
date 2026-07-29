export interface CodeFile {
  name: string;
  language: string;
  description: string;
  content: string;
}

export const androidCodeFiles: CodeFile[] = [
  {
    name: "MainActivity.kt",
    language: "kotlin",
    description: "Core Activity initiating WebView asset loading, registering JavascriptInterface bridges, camera scanner, and dispatching keystrokes.",
    content: `package com.example.hidkeyserver

import android.annotation.SuppressLint
import android.os.Bundle
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private val TAG = "HID_MainActivity"
    
    // Toggle state for transmission channels
    private var useBluetoothChannel = true
    
    // Injectable writers and services
    private lateinit var usbHidWriter: UsbHidWriter
    private lateinit var bluetoothHidService: BluetoothHidService
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Initialize core HID controllers
        usbHidWriter = UsbHidWriter()
        bluetoothHidService = BluetoothHidService(this)

        // Configure WebView to load web app from assets (app/src/main/assets/)
        setupWebView()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView = findViewById<WebView>(R.id.webView) ?: WebView(this).also {
            setContentView(it)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        // Expose native JavaScript interfaces so web frontend can trigger native unlock
        val bridgeInterface = WebAppInterface()
        webView.addJavascriptInterface(bridgeInterface, "AndroidBridge")
        webView.addJavascriptInterface(bridgeInterface, "AndroidInterface")

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView?,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                Log.e(TAG, "WebView Asset Loading Error: $description ($errorCode) at $failingUrl")
                if (failingUrl?.contains("index.html") == true || failingUrl?.startsWith("file:///android_asset") == true) {
                    // Graceful fallback to avoid persistent white screen if assets are missing or misconfigured
                    val fallbackHtml = """
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <style>
                                body { background: #0f172a; color: #f8fafc; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; }
                                .card { background: #1e293b; padding: 24px; border-radius: 20px; border: 1px solid #334155; max-width: 340px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
                                h2 { color: #38bdf8; margin-top: 0; font-size: 20px; font-weight: 800; }
                                p { color: #94a3b8; font-size: 13px; line-height: 1.5; }
                                .badge { display: inline-block; background: #0284c7; color: #ffffff; padding: 6px 12px; border-radius: 12px; font-size: 11px; font-weight: bold; margin-top: 10px; font-mono: monospace; }
                            </style>
                        </head>
                        <body>
                            <div class="card">
                                <h2>Keyflow Security HID</h2>
                                <p>Loading application interface from assets...</p>
                                <div class="badge">file:///android_asset/index.html</div>
                                <p style="font-size:11px; margin-top:14px; color:#64748b;">Mirror Vite build output (index.html, JS, CSS) inside app/src/main/assets/</p>
                            </div>
                        </body>
                        </html>
                    """.trimIndent()
                    view?.loadDataWithBaseURL("file:///android_asset/", fallbackHtml, "text/html", "UTF-8", null)
                }
            }
        }

        // Primary Asset URL Loading
        try {
            webView.loadUrl("file:///android_asset/index.html")
            Log.i(TAG, "WebView initiated with URL: file:///android_asset/index.html")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to loadUrl file:///android_asset/index.html", e)
        }
    }

    /**
     * JavaScript Bridge Interface allowing the web app to trigger native HID unlock keystrokes directly.
     */
    inner class WebAppInterface {
        @JavascriptInterface
        fun sendUnlockPassword(password: String) {
            Log.i(TAG, "Bridge method sendUnlockPassword received: $password")
            transmitPayload(password)
        }

        @JavascriptInterface
        fun sendKeystrokes(keystrokes: String) {
            Log.i(TAG, "Bridge method sendKeystrokes received: $keystrokes")
            transmitPayload(keystrokes)
        }

        @JavascriptInterface
        fun unlock(password: String) {
            Log.i(TAG, "Bridge method unlock received: $password")
            transmitPayload(password)
        }

        @JavascriptInterface
        fun sendPassword(password: String) {
            Log.i(TAG, "Bridge method sendPassword received: $password")
            transmitPayload(password)
        }
    }

    /**
     * Triggered automatically when the QR Code scanner reads a string payload.
     * Expects payload format: "CodeWE:<digits>" (e.g., "CodeWE:240504000")
     */
    fun onQrCodeScanned(rawData: String) {
        Log.i(TAG, "Raw QR Payload detected: $rawData")
        
        // 1. Validate and Parse: Strip the prefix "CodeWE:"
        val prefix = "CodeWE:"
        val cleanPayload = if (rawData.startsWith(prefix)) rawData.substring(prefix.length) else rawData

        // 2. Cipher Logic: Replace any substring "000" with "786"
        val finalPassword = cleanPayload.replace("000", "786")
        Log.i(TAG, "Transformed credentials payload: $finalPassword")

        // 3. Dual-Channel Transmission
        transmitPayload(finalPassword)
    }

    fun transmitPayload(payload: String) {
        lifecycleScope.launch {
            if (useBluetoothChannel) {
                // Channel 2: Bluetooth HID
                showToast("Transmitting via Bluetooth HID...")
                val success = bluetoothHidService.transmitKeystrokes(payload)
                if (success) {
                    showToast("Bluetooth Keypresses sent successfully!")
                } else {
                    showToast("Bluetooth Transmission failed. Host not ready.")
                }
            } else {
                // Channel 1: USB Gadget Mode (requires Kernel HID configuration)
                showToast("Transmitting via USB Gadget (/dev/hidg0)...")
                val success = withContext(Dispatchers.IO) {
                    usbHidWriter.writeKeystrokes(payload)
                }
                if (success) {
                    showToast("USB Keypresses sent successfully!")
                } else {
                    showToast("USB write failed. Check /dev/hidg0 permissions.")
                }
            }
        }
    }

    private fun showToast(msg: String) {
        runOnUiThread {
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        bluetoothHidService.close()
    }
}`
  },
  {
    name: "AndroidManifest.xml",
    language: "xml",
    description: "Android application manifest specifying Bluetooth, USB OTG, Camera permissions, and app launcher icon.",
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.hidkeyserver">

    <!-- Permissions for Bluetooth HID, USB OTG, Camera QR Scanning & Network -->
    <uses-permission android:name="android.permission.BLUETOOTH" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="Keyflow Security HID"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.AppCompat.NoActionBar">

        <!-- 
            App Icon Configuration:
            The Keyflow logo ("img.png" located in the assets folder) is mapped to 
            @mipmap/ic_launcher (app/src/main/res/mipmap-xxhdpi/ic_launcher.png) 
            so the icon displays cleanly on the mobile device's home screen.
        -->

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>`
  },
  {
    name: "activity_main.xml",
    language: "xml",
    description: "Layout XML embedding the fullscreen WebView container for web asset rendering.",
    content: `<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#0f172a">

    <WebView
        android:id="@+id/webView"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

</RelativeLayout>`
  },
  {
    name: "UsbHidWriter.kt",
    language: "kotlin",
    description: "Handles writing standard 8-byte USB input report structures to the Linux kernel OTG file system (/dev/hidg0).",
    content: `package com.example.hidkeyserver

import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * Handles communication with the Linux gadget driver for human interface devices.
 * Writes raw key input reports directly to the kernel node /dev/hidg0.
 */
class UsbHidWriter {

    private val TAG = "USB_HidWriter"
    private val HID_DEV_PATH = "/dev/hidg0"

    /**
     * Takes a plain text string, maps each character to a hardware USB scan code,
     * and streams the packets as keypress/release reports.
     */
    fun writeKeystrokes(text: String): Boolean {
        val file = File(HID_DEV_PATH)
        if (!file.exists() || !file.canWrite()) {
            Log.e(TAG, "HID Node $HID_DEV_PATH is not writable or doesn't exist.")
            return false
        }

        var fos: FileOutputStream? = null
        try {
            fos = FileOutputStream(file)
            
            // Loop through each char, map, and send key-press + key-release reports
            for (char in text) {
                val scanCode = HidMapper.getScanCode(char)
                if (scanCode != null) {
                    // Send Press Report
                    val pressReport = HidMapper.createInputReport(scanCode)
                    fos.write(pressReport)
                    fos.flush()
                    
                    Thread.sleep(20) // 20ms hold delay for keyboard recognition

                    // Send Release Report (All zeros)
                    val releaseReport = HidMapper.createReleaseReport()
                    fos.write(releaseReport)
                    fos.flush()
                    
                    Thread.sleep(15) // Debounce delay before next key
                } else {
                    Log.w(TAG, "No HID scan code mapped for character: $char")
                }
            }

            // Always submit with an automated Enter/Return key press to unlock
            val enterScanCode = HidMapper.getEnterScanCode()
            fos.write(HidMapper.createInputReport(enterScanCode))
            fos.flush()
            Thread.sleep(20)
            fos.write(HidMapper.createReleaseReport())
            fos.flush()

            return true
        } catch (e: IOException) {
            Log.e(TAG, "IOException writing to $HID_DEV_PATH: \${e.message}", e)
            return false
        } finally {
            try {
                fos?.close()
            } catch (e: IOException) {
                Log.e(TAG, "Error closing stream", e)
            }
        }
    }
}`
  },
  {
    name: "BluetoothHidService.kt",
    language: "kotlin",
    description: "Interfaces with the native Android BluetoothHidDevice API to register an SDP profile and stream keypresses.",
    content: `package com.example.hidkeyserver

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHidDevice
import android.bluetooth.BluetoothHidDeviceAppSdpSettings
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.util.Log
import java.util.concurrent.Executors

/**
 * Manages the Bluetooth HID Profile service.
 * Available from Android 9 (API Level 28) onwards. Registers the Android device
 * as a peripheral keyboard and broadcasts reports over active wireless L2CAP channels.
 */
@SuppressLint("MissingPermission")
class BluetoothHidService(private val context: Context) {

    private val TAG = "BT_HidService"
    private var bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private var bluetoothHidDevice: BluetoothHidDevice? = null
    private var activeHostDevice: BluetoothDevice? = null
    private var isRegistered = false

    // SDP Descriptor defining USB keyboard features to the host PC
    private val sdpSettings = BluetoothHidDeviceAppSdpSettings(
        "Android Security HID Key",
        "Android Emulated Keyboard Security Key",
        "Google Inc.",
        BluetoothHidDevice.SUBCLASS_KEYBOARD,
        HidMapper.KEYBOARD_HID_DESCRIPTOR
    )

    init {
        initializeProfile()
    }

    private fun initializeProfile() {
        if (bluetoothAdapter == null) {
            Log.e(TAG, "Bluetooth not supported on this device.")
            return
        }

        bluetoothAdapter?.getProfileProxy(context, object : BluetoothProfile.ServiceListener {
            override fun onServiceConnected(profile: Int, proxy: BluetoothProfile?) {
                if (profile == BluetoothProfile.HID_DEVICE) {
                    bluetoothHidDevice = proxy as BluetoothHidDevice
                    registerApp()
                }
            }

            override fun onServiceDisconnected(profile: Int) {
                if (profile == BluetoothProfile.HID_DEVICE) {
                    bluetoothHidDevice = null
                    isRegistered = false
                }
            }
        }, BluetoothProfile.HID_DEVICE)
    }

    private fun registerApp() {
        val executor = Executors.newSingleThreadExecutor()
        bluetoothHidDevice?.registerApp(
            sdpSettings,
            null,
            null,
            executor,
            object : BluetoothHidDevice.Callback() {
                override fun onAppStatusChanged(pluggedDevice: BluetoothDevice?, registered: Boolean) {
                    super.onAppStatusChanged(pluggedDevice, registered)
                    isRegistered = registered
                    Log.i(TAG, "Profile registration status: $registered")
                }

                override fun onConnectionStateChanged(device: BluetoothDevice?, state: Int) {
                    super.onConnectionStateChanged(device, state)
                    Log.i(TAG, "Bluetooth HID connection state changed: $state")
                    activeHostDevice = if (state == BluetoothProfile.STATE_CONNECTED) {
                        device
                    } else {
                        null
                    }
                }
            }
        )
    }

    /**
     * Transmits the credentials string over Bluetooth L2CAP to the paired Host.
     */
    fun transmitKeystrokes(text: String): Boolean {
        val bthid = bluetoothHidDevice ?: return false
        val device = activeHostDevice ?: return false

        if (!isRegistered) {
            Log.e(TAG, "Service is not registered.")
            return false
        }

        // Loop through characters and send key press / release reports
        for (char in text) {
            val scanCode = HidMapper.getScanCode(char) ?: continue
            
            // 1. Send press report
            val pressReport = HidMapper.createInputReport(scanCode)
            bthid.sendReport(device, HidMapper.REPORT_ID_KEYBOARD, pressReport)
            Thread.sleep(20)
            
            // 2. Send release report
            val releaseReport = HidMapper.createReleaseReport()
            bthid.sendReport(device, HidMapper.REPORT_ID_KEYBOARD, releaseReport)
            Thread.sleep(15)
        }

        // Send terminating Enter key
        val enterScanCode = HidMapper.getEnterScanCode()
        bthid.sendReport(device, HidMapper.REPORT_ID_KEYBOARD, HidMapper.createInputReport(enterScanCode))
        Thread.sleep(20)
        bthid.sendReport(device, HidMapper.REPORT_ID_KEYBOARD, HidMapper.createReleaseReport())

        return true
    }

    fun close() {
        if (bluetoothHidDevice != null && isRegistered) {
            bluetoothHidDevice?.unregisterApp()
        }
        bluetoothAdapter?.closeProfileProxy(BluetoothProfile.HID_DEVICE, bluetoothHidDevice)
    }
}`
  },
  {
    name: "HidMapper.kt",
    language: "kotlin",
    description: "Contains raw byte constants, keyboard layouts, and SDP reports descriptor structures.",
    content: `package com.example.hidkeyserver

/**
 * Maps readable characters to standard USB HID Usage IDs and packages reports.
 * Compliant with USB HID Spec 1.11.
 */
object HidMapper {

    const val REPORT_ID_KEYBOARD = 1.toByte()

    // Standard Keyboard SDP descriptor mapping keys, modifiers, and LEDs
    val KEYBOARD_HID_DESCRIPTOR = byteArrayOf(
        0x05.toByte(), 0x01.toByte(), // USAGE_PAGE (Generic Desktop)
        0x09.toByte(), 0x06.toByte(), // USAGE (Keyboard)
        0xa1.toByte(), 0x01.toByte(), // COLLECTION (Application)
        0x85.toByte(), REPORT_ID_KEYBOARD, // REPORT_ID (1)
        
        // Modifier keys byte
        0x05.toByte(), 0x07.toByte(), // USAGE_PAGE (Keyboard)
        0x19.toByte(), 0xe0.toByte(), // USAGE_MINIMUM (Keyboard LeftControl)
        0x29.toByte(), 0xe7.toByte(), // USAGE_MAXIMUM (Keyboard Right GUI)
        0x15.toByte(), 0x00.toByte(), // LOGICAL_MINIMUM (0)
        0x25.toByte(), 0x01.toByte(), // LOGICAL_MAXIMUM (1)
        0x75.toByte(), 0x01.toByte(), // REPORT_SIZE (1)
        0x95.toByte(), 0x08.toByte(), // REPORT_COUNT (8)
        0x81.toByte(), 0x02.toByte(), // INPUT (Data,Var,Abs)
        
        // Reserved byte
        0x95.toByte(), 0x01.toByte(), // REPORT_COUNT (1)
        0x75.toByte(), 0x08.toByte(), // REPORT_SIZE (8)
        0x81.toByte(), 0x01.toByte(), // INPUT (Cnst,Ary,Abs)
        
        // LED indicators output report (optional but required by standard)
        0x95.toByte(), 0x05.toByte(), // REPORT_COUNT (5)
        0x75.toByte(), 0x01.toByte(), // REPORT_SIZE (1)
        0x05.toByte(), 0x08.toByte(), // USAGE_PAGE (LEDs)
        0x19.toByte(), 0x01.toByte(), // USAGE_MINIMUM (Num Lock)
        0x29.toByte(), 0x05.toByte(), // USAGE_MAXIMUM (Kana)
        0x91.toByte(), 0x02.toByte(), // OUTPUT (Data,Var,Abs)
        0x95.toByte(), 0x01.toByte(), // REPORT_COUNT (1)
        0x75.toByte(), 0x03.toByte(), // REPORT_SIZE (3)
        0x91.toByte(), 0x01.toByte(), // OUTPUT (Cnst,Ary,Abs)
        
        // Key codes buffer (up to 6 simultaneous keys)
        0x95.toByte(), 0x06.toByte(), // REPORT_COUNT (6)
        0x75.toByte(), 0x08.toByte(), // REPORT_SIZE (8)
        0x15.toByte(), 0x00.toByte(), // LOGICAL_MINIMUM (0)
        0x25.toByte(), 0x65.toByte(), // LOGICAL_MAXIMUM (101)
        0x05.toByte(), 0x07.toByte(), // USAGE_PAGE (Keyboard)
        0x19.toByte(), 0x00.toByte(), // USAGE_MINIMUM (Reserved)
        0x29.toByte(), 0x65.toByte(), // USAGE_MAXIMUM (Keyboard Application)
        0x81.toByte(), 0x00.toByte(), // INPUT (Data,Ary,Abs)
        0xc0.toByte()                 // END_COLLECTION
    )

    /**
     * Map characters 0-9 to USB HID Usage ID Hex Codes
     */
    fun getScanCode(char: Char): Byte? {
        return when (char) {
            '1' -> 0x1E.toByte()
            '2' -> 0x1F.toByte()
            '3' -> 0x20.toByte()
            '4' -> 0x21.toByte()
            '5' -> 0x22.toByte()
            '6' -> 0x23.toByte()
            '7' -> 0x24.toByte()
            '8' -> 0x25.toByte()
            '9' -> 0x26.toByte()
            '0' -> 0x27.toByte()
            else -> null
        }
    }

    fun getEnterScanCode(): Byte {
        return 0x28.toByte() // Enter/Return
    }

    /**
     * Creates standard 8-byte input report with modifier, reserved, and keys payload.
     * Report format: [Modifier, Reserved, Key1, Key2, Key3, Key4, Key5, Key6]
     */
    fun createInputReport(keyCode: Byte): ByteArray {
        val report = ByteArray(8)
        report[0] = 0x00.toByte() // No modifier (e.g., Shift, Alt, Ctrl)
        report[1] = 0x00.toByte() // Reserved
        report[2] = keyCode       // First slot is our active scan code
        // Remaining 5 slots are 0x00 (no other keys held)
        return report
    }

    /**
     * Creates an all-zero report indicating all keys have been released.
     */
    fun createReleaseReport(): ByteArray {
        return ByteArray(8)
    }
}
`
  }
];
