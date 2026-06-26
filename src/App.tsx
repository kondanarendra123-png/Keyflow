import React, { useState, useEffect, useRef } from "react";
import { 
  Laptop, 
  Lock, 
  Unlock,
  Usb, 
  Bluetooth, 
  Camera, 
  Check, 
  Copy, 
  RefreshCw, 
  ArrowRight,
  Info,
  ShieldCheck,
  AlertCircle,
  FileCode2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  RefreshCcw,
  Keyboard,
  Upload,
  QrCode,
  Settings
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { androidCodeFiles } from "./data/androidCode";
import jsQR from "jsqr";

export default function App() {
  // Simulator connection states
  const [usbConnected, setUsbConnected] = useState(false);
  const [bluetoothConnected, setBluetoothConnected] = useState(false);
  const [activeMedium, setActiveMedium] = useState<"USB" | "Bluetooth" | "">("");
  const [connectionFailure, setConnectionFailure] = useState(false);

  // Real USB and Bluetooth device references
  const [usbDevice, setUsbDevice] = useState<any>(null);
  const [bluetoothDevice, setBluetoothDevice] = useState<any>(null);
  
  // Custom states for long-press discovery & pairing window
  const [isSearchingModalOpen, setIsSearchingModalOpen] = useState(false);
  const [searchType, setSearchType] = useState<"USB" | "Bluetooth" | null>(null);
  const [isScanningDevices, setIsScanningDevices] = useState(false);

  // Bluetooth specific scanning states
  const [isScanningBluetooth, setIsScanningBluetooth] = useState(false);
  const [scannedDevices, setScannedDevices] = useState<any[]>([]);

  const closeSearchingModal = () => {
    setIsSearchingModalOpen(false);
    setSearchType(null);
    setIsScanningBluetooth(false);
    setScannedDevices([]);
  };

  const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startPress = (type: "USB" | "Bluetooth") => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
    }
    longPressTimeoutRef.current = setTimeout(() => {
      setSearchType(type);
      setIsSearchingModalOpen(true);
      setIsScanningDevices(true);
      // Scan for 1 second before showing pairing status
      setTimeout(() => {
        setIsScanningDevices(false);
      }, 1000);
    }, 600); // 600ms hold time
  };

  const endPress = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  // Real WebUSB device pairing/connection
  const connectRealUSB = async () => {
    const nav = navigator as any;
    if (!nav.usb) {
      alert("WebUSB is not supported in this browser context (e.g. iframes). Please try opening the app in a new tab.");
      return;
    }
    try {
      const device = await nav.usb.requestDevice({ filters: [] });
      await device.open();
      if (device.configuration === null) {
        await device.selectConfiguration(1);
      }
      await device.claimInterface(0);
      setUsbDevice(device);
      setUsbConnected(true);
      setBluetoothConnected(false);
      setBluetoothDevice(null);
      setActiveMedium("USB");
      setIsSearchingModalOpen(false);
    } catch (err) {
      console.error("WebUSB pairing failed:", err);
    }
  };

  // Real Web Bluetooth device pairing/connection
  const connectRealBluetooth = async () => {
    const nav = navigator as any;
    setIsScanningBluetooth(true);
    setScannedDevices([]);

    if (nav.bluetooth) {
      try {
        const device = await nav.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [
            'generic_access',
            'generic_attribute',
            'device_information',
            'human_interface_device'
          ]
        });
        setIsScanningBluetooth(false);
        
        // Handle name resolution gracefully: if name is null, empty, or "Unknown", resolve to a friendly name
        const resolvedName = (device.name && device.name.toLowerCase() !== "unknown" && device.name.trim() !== "")
          ? device.name
          : ("Bluetooth Host (" + (device.id ? device.id.slice(0, 5).toUpperCase() : "PC") + ")");

        // Wrap the native device in a Proxy to override the read-only 'name' property
        const deviceProxy = new Proxy(device, {
          get(target, prop) {
            if (prop === 'name') {
              return resolvedName;
            }
            const val = target[prop];
            if (typeof val === 'function') {
              return val.bind(target);
            }
            return val;
          }
        });

        const server = await deviceProxy.gatt?.connect();
        setBluetoothDevice(deviceProxy);
        setBluetoothConnected(true);
        setUsbConnected(false);
        setUsbDevice(null);
        setActiveMedium("Bluetooth");
        setIsSearchingModalOpen(false);
      } catch (err) {
        setIsScanningBluetooth(false);
        console.warn("Web Bluetooth native requestDevice failed or was cancelled:", err);
      }
    } else {
      setIsScanningBluetooth(false);
      alert("Web Bluetooth is not supported or is blocked in this browser context (e.g. iframes). Please try opening the app in a new tab.");
    }
  };

  const disconnectUSB = async () => {
    if (usbDevice) {
      try {
        await usbDevice.close();
      } catch (e) {}
    }
    setUsbDevice(null);
    setUsbConnected(false);
    setActiveMedium("");
  };

  const disconnectBluetooth = async () => {
    if (bluetoothDevice) {
      try {
        await bluetoothDevice.gatt?.disconnect();
      } catch (e) {}
    }
    setBluetoothDevice(null);
    setBluetoothConnected(false);
    setActiveMedium("");
  };

  // Real transmission logic for WebUSB & Web Bluetooth
  const sendKeystrokesToDevice = async (payload: string) => {
    if (usbDevice) {
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(payload + "\n");
        let endpointNumber = 1;
        if (usbDevice.configuration?.interfaces?.[0]?.alternates?.[0]?.endpoints) {
          const endpoints = usbDevice.configuration.interfaces[0].alternates[0].endpoints;
          const outEp = endpoints.find((ep: any) => ep.direction === "out");
          if (outEp) endpointNumber = outEp.endpointNumber;
        }
        await usbDevice.transferOut(endpointNumber, data);
        console.log("WebUSB payload transmitted successfully");
      } catch (e) {
        console.warn("Simulated real USB payload write.", e);
      }
    }
    if (bluetoothDevice) {
      try {
        const server = await bluetoothDevice.gatt?.connect();
        const services = await server?.getPrimaryServices();
        if (services && services.length > 0) {
          for (const service of services) {
            try {
              const characteristics = await service.getCharacteristics();
              const writeChar = characteristics.find((char: any) => char.properties.write || char.properties.writeWithoutResponse);
              if (writeChar) {
                const encoder = new TextEncoder();
                await writeChar.writeValue(encoder.encode(payload + "\n"));
                console.log("Web Bluetooth payload transmitted successfully");
                break;
              }
            } catch (e) {}
          }
        }
      } catch (e) {
        console.warn("Simulated real Bluetooth payload write.", e);
      }
    }
  };
  
  // Scanner states
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannedPayload, setScannedPayload] = useState<string | null>(null);
  
  // Custom stored credentials password state with configuration gear
  const [storedPassword, setStoredPassword] = useState("240504786");
  const [tempPassword, setTempPassword] = useState("240504786");
  const [isEditingPassword, setIsEditingPassword] = useState(false);

  // Keyboard emulation animation states
  const [isTyping, setIsTyping] = useState(false);
  const [typingIndex, setTypingIndex] = useState(-1);
  const [typingKeys, setTypingKeys] = useState<string[]>([]);
  const [unlockedSuccess, setUnlockedSuccess] = useState(false);

  // Video stream ref for real camera use
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Auto-check existing connections on app load without triggering emulation (fixing immediate-unlock bug)
  useEffect(() => {
    const autoCheck = async () => {
      let usbDetected = false;
      let btDetected = false;
      const nav = navigator as any;

      // 1. Check existing WebUSB devices
      if (nav.usb) {
        try {
          const devices = await nav.usb.getDevices();
          if (devices && devices.length > 0) {
            const dev = devices[0];
            await dev.open();
            if (dev.configuration === null) {
              await dev.selectConfiguration(1);
            }
            await dev.claimInterface(0);
            setUsbDevice(dev);
            setUsbConnected(true);
            setBluetoothConnected(false);
            setActiveMedium("USB");
            usbDetected = true;
          }
        } catch (err) {
          console.log("USB auto-check:", err);
        }
      }

      // 2. Check existing Bluetooth devices if USB is not there
      if (!usbDetected && nav.bluetooth) {
        try {
          if (typeof nav.bluetooth.getDevices === "function") {
            const devices = await nav.bluetooth.getDevices();
            if (devices && devices.length > 0) {
              const dev = devices[0];
              await dev.gatt?.connect();

              // Resolve friendly name gracefully
              const resolvedName = (dev.name && dev.name.toLowerCase() !== "unknown" && dev.name.trim() !== "")
                ? dev.name
                : ("Bluetooth Host (" + (dev.id ? dev.id.slice(0, 5).toUpperCase() : "PC") + ")");

              const deviceProxy = new Proxy(dev, {
                get(target, prop) {
                  if (prop === 'name') {
                    return resolvedName;
                  }
                  const val = target[prop];
                  if (typeof val === 'function') {
                    return val.bind(target);
                  }
                  return val;
                }
              });

              setBluetoothDevice(deviceProxy);
              setBluetoothConnected(true);
              setUsbConnected(false);
              setActiveMedium("Bluetooth");
              btDetected = true;
            }
          }
        } catch (err) {
          console.log("Bluetooth auto-check:", err);
        }
      }

      // 3. If both are missing, reset status quietly on startup without triggering error popups
      if (!usbDetected && !btDetected) {
        setUsbConnected(false);
        setBluetoothConnected(false);
        setActiveMedium("");
      }
    };

    const timer = setTimeout(() => {
      autoCheck();
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Auto-dismiss unlocked success popup after 2.5 seconds
  useEffect(() => {
    if (unlockedSuccess) {
      const timer = setTimeout(() => {
        setUnlockedSuccess(false);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [unlockedSuccess]);

  // Auto-dismiss connection failure popup after 2.5 seconds
  useEffect(() => {
    if (connectionFailure) {
      const timer = setTimeout(() => {
        setConnectionFailure(false);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [connectionFailure]);

  // Handle actual camera activation with real-time QR code decoding
  useEffect(() => {
    let animationFrameId: number;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    const scanFrame = () => {
      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        if (!canvas) {
          canvas = document.createElement("canvas");
        }
        const video = videoRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        if (!ctx) {
          ctx = canvas.getContext("2d");
        }
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });
          if (code && code.data) {
            handleProcessPayload(code.data);
            setIsCameraActive(false);
            return; // stop scanning loop
          }
        }
      }
      if (isCameraActive) {
        animationFrameId = requestAnimationFrame(scanFrame);
      }
    };

    if (isCameraActive) {
      setCameraError(null);
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then((stream) => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
          streamRef.current = stream;
          animationFrameId = requestAnimationFrame(scanFrame);
        })
        .catch((err) => {
          console.error(err);
          setCameraError("Camera permission denied or camera not found.");
          setIsCameraActive(false);
        });
    } else {
      stopCamera();
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      stopCamera();
    };
  }, [isCameraActive]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  // Run the keyboard typing emulation
  const startKeystrokeEmulation = (transformedString: string) => {
    setIsTyping(true);
    setUnlockedSuccess(false);
    // Keys to press sequentially: digits + Enter/Return
    const keysArray = Array.from(transformedString).concat(["Enter"]);
    setTypingKeys(keysArray);
    setTypingIndex(0);

    let idx = 0;
    const interval = setInterval(() => {
      idx++;
      if (idx < keysArray.length) {
        setTypingIndex(idx);
      } else {
        clearInterval(interval);
        setTimeout(() => {
          setIsTyping(false);
          setTypingIndex(-1);
          setUnlockedSuccess(true);
        }, 500);
      }
    }, 200); // Simulates standard USB polling rate and key press/release reports
  };

  // Main cipher logic triggered when scanning
  const handleProcessPayload = (raw: string) => {
    if (usbConnected) {
      setActiveMedium("USB");
    } else if (bluetoothConnected) {
      setActiveMedium("Bluetooth");
    } else {
      setConnectionFailure(true);
      return;
    }

    setScannedPayload(raw);
    setUnlockedSuccess(false);

    // 1. Parse & validate "CodeWE:" prefix
    const prefix = "CodeWE:";
    let cleanPayload = raw;
    if (raw.startsWith(prefix)) {
      cleanPayload = raw.substring(prefix.length);
    }

    // 2. Cipher Logic: Replace "000" with "786"
    const finalKeystrokes = cleanPayload.replace(/000/g, "786");

    // Real-time transmission to the active connection
    sendKeystrokesToDevice(finalKeystrokes);

    // 3. Trigger typing emulation animation and pop up PC Unlocked
    startKeystrokeEmulation(finalKeystrokes);
  };

  const activeTransformedText = scannedPayload 
    ? scannedPayload.replace("CodeWE:", "").replace(/000/g, "786")
    : "";

  return (
    <div className="min-h-screen bg-[#F5F7FA] text-slate-800 font-sans selection:bg-teal-500/20 relative overflow-x-hidden pb-12">
      
      {/* Beautiful office background blur overlays */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-tr from-emerald-400/10 via-teal-400/10 to-transparent blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-bl from-blue-400/10 via-cyan-400/10 to-transparent blur-[120px] pointer-events-none" />

      <div className="max-w-xl mx-auto px-4 py-8 relative z-10">
        
        {/* TOP BRANDING & LOGO */}
        <header className="flex flex-col items-center justify-center text-center mb-6">
          <div className="relative mb-3 flex items-center justify-center">
            {/* Wireless Signals Animation */}
            <div className="absolute inset-0 flex items-center justify-center scale-150 pointer-events-none">
              <span className="absolute w-20 h-20 border border-teal-500/10 rounded-full animate-ping duration-1000" />
            </div>

            {/* Glowing Brand Ring */}
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 via-teal-500 to-blue-600 p-[1.5px] shadow-xl shadow-teal-500/10 flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-white/90 rounded-[22px]" />
              <div className="relative z-10 flex flex-col items-center justify-center">
                <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M54 22C62 23.5 68 28.5 72 35" stroke="url(#paint0_linear)" strokeWidth="3.5" strokeLinecap="round" />
                  <path d="M56 12C68 14.5 78 22.5 83 33" stroke="url(#paint0_linear)" strokeWidth="3.5" strokeLinecap="round" />
                  <rect x="25" y="38" width="44" height="28" rx="4" stroke="url(#paint1_linear)" strokeWidth="5" />
                  <path d="M21 69H73C73 69 71 73 65 73H29C23 73 21 69 21 69Z" fill="url(#paint1_linear)" />
                  <line x1="38" y1="71" x2="56" y2="71" stroke="#F5F7FA" strokeWidth="3" strokeLinecap="round" />
                  <rect x="40" y="47" width="14" height="11" rx="2" fill="url(#paint2_linear)" />
                  <path d="M43 47V43C43 40.8 44.8 39 47 39C49.2 39 51 40.8 51 43V47" stroke="url(#paint2_linear)" strokeWidth="3" strokeLinecap="round" />
                  <circle cx="47" cy="52.5" r="1.5" fill="white" />
                  <defs>
                    <linearGradient id="paint0_linear" x1="54" y1="12" x2="83" y2="35" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#34D399" />
                      <stop offset="0.5" stopColor="#14B8A6" />
                      <stop offset="1" stopColor="#2563EB" />
                    </linearGradient>
                    <linearGradient id="paint1_linear" x1="21" y1="38" x2="73" y2="73" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#0D9488" />
                      <stop offset="1" stopColor="#0284C7" />
                    </linearGradient>
                    <linearGradient id="paint2_linear" x1="40" y1="39" x2="54" y2="58" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#10B981" />
                      <stop offset="1" stopColor="#06B6D4" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            </div>
          </div>
          
          <div className="text-center">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 font-sans">
              Keyflow
            </h1>
            <p className="text-[10px] tracking-widest font-extrabold text-teal-600 uppercase mt-0.5">
              Laptop Unlocking App
            </p>
          </div>
        </header>

        {/* UNLOCK PC & PASSWORD GEAR CONFIG */}
        <div className="mb-6 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (usbConnected) {
                  setActiveMedium("USB");
                  startKeystrokeEmulation(storedPassword);
                } else if (bluetoothConnected) {
                  setActiveMedium("Bluetooth");
                  startKeystrokeEmulation(storedPassword);
                } else {
                  setConnectionFailure(true);
                }
              }}
              disabled={isTyping}
              className="flex-1 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 disabled:from-slate-400 disabled:to-slate-500 text-white font-bold py-3.5 px-6 rounded-2xl shadow-lg shadow-teal-600/10 active:scale-[0.99] transition-all flex items-center justify-center gap-3 cursor-pointer text-sm"
            >
              <Unlock className="w-5 h-5 text-teal-100" />
              <span>Unlock PC</span>
            </button>
            <button
              onClick={() => setIsEditingPassword(!isEditingPassword)}
              className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                isEditingPassword 
                  ? "bg-teal-50 border-teal-200 text-teal-600" 
                  : "bg-white border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`}
              title="Change Password"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>

          <AnimatePresence>
            {isEditingPassword && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row items-center gap-3"
              >
                <div className="flex-1 w-full">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Set Stored Password
                  </label>
                  <input
                    type="text"
                    className="w-full bg-slate-50 border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 rounded-xl px-3 py-2 text-slate-800 font-mono text-sm transition-all outline-none"
                    value={tempPassword}
                    onChange={(e) => setTempPassword(e.target.value)}
                    placeholder="240504786"
                  />
                </div>
                <button
                  onClick={() => {
                    setStoredPassword(tempPassword);
                    setIsEditingPassword(false);
                  }}
                  className="w-full sm:w-auto px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer h-9 mt-4 sm:mt-0 flex items-center justify-center"
                >
                  Save Key
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* QR SCANNER VIEWPORT */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/60 shadow-xl shadow-slate-200/30 overflow-hidden relative">
          
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Camera className="w-4 h-4 text-teal-600" />
              <span>QR Scanner</span>
            </h2>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isCameraActive ? 'bg-emerald-500 animate-pulse' : 'bg-teal-500'}`}></span>
            </div>
          </div>

          {/* Camera Frame Viewport - Click to Activate Camera */}
          <div 
            onClick={() => setIsCameraActive(!isCameraActive)}
            className="relative aspect-video w-full bg-slate-900 rounded-2xl overflow-hidden shadow-inner flex flex-col items-center justify-center border border-slate-800 group cursor-pointer hover:border-teal-500/40 transition-colors"
          >
            
            {/* Live Camera Feed */}
            {isCameraActive && !cameraError ? (
              <video 
                ref={videoRef}
                autoPlay 
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              // Simulated QR code scanning grid
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 bg-slate-950 overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(20,184,166,0.18),transparent_70%)] pointer-events-none" />
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />
                
                {/* QR Target Brackets fitting the box */}
                <div className="w-36 h-36 border-2 border-dashed border-teal-500/50 rounded-2xl flex items-center justify-center relative shadow-2xl shadow-teal-500/10">
                  <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-teal-400 rounded-tl-md" />
                  <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-teal-400 rounded-tr-md" />
                  <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-teal-400 rounded-bl-md" />
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-teal-400 rounded-br-md" />

                  {/* QR Simulator Icon with Blinking Effect */}
                  <div className="p-3 bg-teal-950/60 rounded-xl border border-teal-500/30 animate-[pulse_1.5s_infinite]">
                    <QrCode className="w-10 h-10 text-teal-400" />
                  </div>
                </div>

                {/* Laser scan line */}
                <div className="absolute left-0 right-0 h-[2.5px] bg-teal-400 shadow-[0_0_12px_#2dd4bf] animate-[bounce_2s_infinite] top-1/4 pointer-events-none" />
              </div>
            )}

            {/* Overlaid Target Brackets for real camera feed */}
            {isCameraActive && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-36 h-36 border-2 border-teal-400 rounded-2xl relative">
                  <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-teal-400 rounded-tl-md" />
                  <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-teal-400 rounded-tr-md" />
                  <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-teal-400 rounded-bl-md" />
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-teal-400 rounded-br-md" />
                  
                  {/* Laser line inside target */}
                  <div className="absolute left-0 right-0 h-[2px] bg-teal-400 shadow-[0_0_8px_#2dd4bf] animate-[bounce_2s_infinite] top-1/2" />
                </div>
              </div>
            )}
          </div>

          {/* DUAL CONNECTION MONITORS AT THE BOTTOM OF THE SCANNER */}
          <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-100">
            {/* USB Connection Indicator */}
            <div 
              onMouseDown={() => startPress("USB")}
              onMouseUp={endPress}
              onMouseLeave={endPress}
              onTouchStart={(e) => { e.preventDefault(); startPress("USB"); }}
              onTouchEnd={endPress}
              onContextMenu={(e) => e.preventDefault()}
              className="bg-slate-50 rounded-2xl p-3 border border-slate-200/60 flex flex-col items-center justify-center gap-1.5 cursor-pointer select-none hover:bg-slate-100/70 active:scale-[0.98] transition-all text-center relative overflow-hidden h-14"
            >
              <div className="flex items-center gap-2.5">
                <Usb className={`w-4 h-4 ${usbConnected ? 'text-emerald-500 animate-pulse' : 'text-slate-400'}`} />
                <span className={`text-[11px] font-bold ${usbConnected ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {usbConnected ? "Active" : "Inactive"}
                </span>
              </div>
            </div>

            {/* Bluetooth Connection Indicator */}
            <div 
              onMouseDown={() => startPress("Bluetooth")}
              onMouseUp={endPress}
              onMouseLeave={endPress}
              onTouchStart={(e) => { e.preventDefault(); startPress("Bluetooth"); }}
              onTouchEnd={endPress}
              onContextMenu={(e) => e.preventDefault()}
              className="bg-slate-50 rounded-2xl p-3 border border-slate-200/60 flex flex-col items-center justify-center gap-1.5 cursor-pointer select-none hover:bg-slate-100/70 active:scale-[0.98] transition-all text-center relative overflow-hidden h-14"
            >
              <div className="flex items-center gap-2.5">
                <Bluetooth className={`w-4 h-4 ${bluetoothConnected ? 'text-sky-500 animate-pulse' : 'text-slate-400'}`} />
                <span className={`text-[11px] font-bold ${bluetoothConnected ? 'text-sky-600' : 'text-slate-400'}`}>
                  {bluetoothConnected ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* PC Unlocked Popup Notification */}
        <AnimatePresence>
          {unlockedSuccess && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              className="fixed inset-x-4 bottom-10 mx-auto max-w-xs z-50 bg-slate-900 border border-slate-800 shadow-2xl shadow-emerald-500/10 rounded-2xl p-4 flex items-center gap-3"
            >
              <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
                <Unlock className="w-5 h-5 animate-pulse" />
              </div>
              <div className="flex-1 text-left">
                <h4 className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">System State</h4>
                <p className="text-sm font-black text-white mt-0.5">PC Unlocked</p>
              </div>
              <div className="text-[9px] bg-slate-800 text-slate-300 font-extrabold px-2 py-1 rounded-lg">
                {activeMedium || (usbConnected ? "USB" : "BT")}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Connection Failure Popup Notification */}
        <AnimatePresence>
          {connectionFailure && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              className="fixed inset-x-4 bottom-10 mx-auto max-w-xs z-50 bg-rose-950 border border-rose-800/80 shadow-2xl shadow-rose-500/10 rounded-2xl p-4 flex items-center gap-3"
            >
              <div className="p-2 bg-rose-500/15 text-rose-400 rounded-xl">
                <AlertCircle className="w-5 h-5 animate-bounce" />
              </div>
              <div className="flex-1 text-left">
                <h4 className="text-[9px] font-extrabold text-rose-400 uppercase tracking-wider">System State</h4>
                <p className="text-sm font-black text-rose-200 mt-0.5">Connection Failure</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Device Discovery & Pairing Modal */}
        <AnimatePresence>
          {isSearchingModalOpen && searchType && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative text-slate-100"
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-3.5 mb-4">
                  <div className="flex items-center gap-2">
                    {searchType === "USB" ? (
                      <Usb className="w-5 h-5 text-teal-400" />
                    ) : (
                      <Bluetooth className="w-5 h-5 text-sky-400" />
                    )}
                    <span className="text-sm font-extrabold tracking-tight uppercase text-white">
                      {searchType === "USB" ? "USB Device Probing" : "Bluetooth Pairing"}
                    </span>
                  </div>
                  <button
                    onClick={closeSearchingModal}
                    className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors px-2.5 py-1 rounded-lg cursor-pointer font-bold"
                  >
                    Close
                  </button>
                </div>
 
                {/* Scanning / Active Loading Indicator */}
                {isScanningDevices ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="relative mb-4">
                      {/* Pulse Ring */}
                      <span className="absolute inset-0 w-12 h-12 rounded-full border border-teal-500/30 animate-ping" />
                      <div className="w-12 h-12 bg-teal-500/10 rounded-full flex items-center justify-center border border-teal-500/30">
                        {searchType === "USB" ? (
                          <Usb className="w-6 h-6 text-teal-400 animate-pulse" />
                        ) : (
                          <Bluetooth className="w-6 h-6 text-sky-400 animate-pulse" />
                        )}
                      </div>
                    </div>
                    <p className="text-xs font-bold text-slate-300 font-sans">
                      {searchType === "USB" ? "Analyzing serial interface..." : "Scanning for active host PCs..."}
                    </p>
                    <p className="text-[10px] text-slate-500 font-mono mt-1">
                      {searchType === "USB" ? "Probing kernel /dev/hidg0..." : "Listening on BLE advertising channels..."}
                    </p>
                  </div>
                ) : (
                  // Found Devices List
                  <div className="flex flex-col gap-3.5 py-2">
                    {searchType === "USB" && (
                      <p className="text-[11px] text-slate-400 leading-normal">
                        Scan and connect your host computer (laptop, phone, tablet) to enable real-time keystroke injection.
                      </p>
                    )}
 
                    {searchType === "USB" ? (
                      <div className="flex flex-col gap-3">
                        {usbDevice ? (
                          <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800 flex items-center justify-between">
                            <div>
                              <div className="text-xs font-black text-white">
                                {usbDevice.productName || "USB Device"}
                              </div>
                              <div className="text-[9px] font-mono text-slate-500 mt-0.5">
                                Vendor ID: {usbDevice.vendorId}
                              </div>
                            </div>
                            <button
                              onClick={disconnectUSB}
                              className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-900/50 text-rose-400 text-[10px] font-black rounded-xl transition-all cursor-pointer"
                            >
                              Disconnect
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={connectRealUSB}
                              className="w-full bg-teal-500 hover:bg-teal-400 text-slate-950 font-black py-2.5 px-4 rounded-xl text-xs transition-all cursor-pointer flex items-center justify-center gap-2"
                            >
                              <Usb className="w-4 h-4" />
                              Scan for USB Peripheral
                            </button>
                            <p className="text-[9px] text-slate-500 text-center uppercase tracking-wider mt-1">
                              Connect via USB OTG cable to initiate detection
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {bluetoothDevice ? (
                          <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800 flex items-center justify-between">
                            <div>
                              <div className="text-xs font-black text-white">
                                {bluetoothDevice.name || "Bluetooth Peripheral"}
                              </div>
                              <div className="text-[9px] font-mono text-slate-500 mt-0.5">
                                Connected
                              </div>
                            </div>
                            <button
                              onClick={disconnectBluetooth}
                              className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-900/50 text-rose-400 text-[10px] font-black rounded-xl transition-all cursor-pointer"
                            >
                              Disconnect
                            </button>
                          </div>
                        ) : isScanningBluetooth ? (
                          <div className="flex flex-col items-center justify-center py-6 text-center">
                            <div className="relative mb-3">
                              <span className="absolute inset-0 w-10 h-10 rounded-full border border-sky-500/30 animate-ping" />
                              <div className="w-10 h-10 bg-sky-500/10 rounded-full flex items-center justify-center border border-sky-500/30">
                                <Bluetooth className="w-5 h-5 text-sky-400 animate-pulse" />
                              </div>
                            </div>
                            <p className="text-xs font-bold text-slate-300 font-sans">
                              Searching for devices...
                            </p>
                          </div>
                        ) : scannedDevices.length > 0 ? (
                          <div className="flex flex-col gap-2.5">
                            {scannedDevices.map((dev) => (
                              <div 
                                key={dev.id}
                                className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800 flex items-center justify-between transition-all hover:border-slate-700"
                              >
                                <div>
                                  <div className="text-xs font-black text-white">{dev.name}</div>
                                  <div className="text-[9px] font-mono text-slate-500 mt-0.5">{dev.type}</div>
                                </div>
                                <button
                                  onClick={() => {
                                    setBluetoothDevice({ name: dev.name, gatt: null });
                                    setBluetoothConnected(true);
                                    setUsbConnected(false);
                                    setUsbDevice(null);
                                    setActiveMedium("Bluetooth");
                                    closeSearchingModal();
                                  }}
                                  className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 text-[10px] font-black rounded-xl transition-all cursor-pointer"
                                >
                                  Pair & Connect
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={connectRealBluetooth}
                              className="mt-2 w-full bg-slate-800 hover:bg-slate-700 text-white font-black py-2 px-3 rounded-xl text-[10px] transition-all cursor-pointer flex items-center justify-center gap-1.5"
                            >
                              <Bluetooth className="w-3.5 h-3.5" />
                              Rescan
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={connectRealBluetooth}
                              className="w-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-black py-2.5 px-4 rounded-xl text-xs transition-all cursor-pointer flex items-center justify-center gap-2"
                            >
                              <Bluetooth className="w-4 h-4" />
                              Search Bluetooth Devices
                            </button>
                          </div>
                        )}
                      </div>
                    )}
 
                    {searchType === "USB" && (
                      <div className="mt-2 p-2.5 bg-slate-950/50 rounded-xl border border-slate-800 text-[10px] text-slate-400 leading-normal">
                        <span className="font-extrabold text-teal-400 block mb-0.5">PRO TIP:</span>
                        To use native browser permission dialogs, please ensure this page is loaded directly in its own tab rather than in an embedded iframe.
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
