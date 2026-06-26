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
    description: "Core Activity initiating camera scanner, running cipher transformation, and dispatching keystrokes.",
    content: `package com.example.hidkeyserver

import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private val TAG = "HID_MainActivity"
    
    // Toggle state for transmission channels
    private var useBluetoothChannel = false
    
    // Injectable writers and services
    private lateinit var usbHidWriter: UsbHidWriter
    private lateinit var bluetoothHidService: BluetoothHidService

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Initialize core HID controllers
        usbHidWriter = UsbHidWriter()
        bluetoothHidService = BluetoothHidService(this)

        // Setup QR scanner launcher/button listener
        setupScannerButton()
    }

    private fun setupScannerButton() {
        // Pseudo logic: When scanner button is clicked, trigger camera scanner
        // e.g., using Google Code Scanner or ML Kit Barcode scanning
        Log.d(TAG, "Scanner initialized. Waiting for QR Code payload.")
    }

    /**
     * Triggered automatically when the QR Code scanner reads a string payload.
     * Expects payload format: "CodeWE:<digits>" (e.g., "CodeWE:240504000")
     */
    fun onQrCodeScanned(rawData: String) {
        Log.i(TAG, "Raw QR Payload detected: $rawData")
        
        // 1. Validate and Parse: Strip the prefix "CodeWE:"
        val prefix = "CodeWE:"
        if (!rawData.startsWith(prefix)) {
            showToast("Invalid QR Format. Prefix must be '$prefix'")
            return
        }
        
        val parsedPayload = rawData.substring(prefix.length)
        Log.d(TAG, "Extracted raw key digits: $parsedPayload")

        // 2. Cipher Logic: Replace any substring "000" with "786"
        val finalPassword = parsedPayload.replace("000", "786")
        Log.i(TAG, "Transformed credentials payload: $finalPassword")

        // 3. Dual-Channel Transmission
        transmitPayload(finalPassword)
    }

    private fun transmitPayload(payload: String) {
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
    description: "Interfaces with the native Android BluetoothHidDevice API to registers an SDP profile and stream keypresses.",
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
     * Transmits the credentials string over Bluetooth L2CAP to the paired Windows Host.
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
}`
  }
];
