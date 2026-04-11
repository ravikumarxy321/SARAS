<div align="center">

# 🤖 SARAS
### Saraswati AI Robot Autonomous System

*Inspired by Goddess Saraswati — Knowledge · Wisdom · Intelligence*

[![Python](https://img.shields.io/badge/Python-3.10-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-2.3.3-000000?style=for-the-badge&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![OpenCV](https://img.shields.io/badge/OpenCV-4.9-5C3EE8?style=for-the-badge&logo=opencv&logoColor=white)](https://opencv.org)
[![Arduino](https://img.shields.io/badge/Arduino-Serial-00979D?style=for-the-badge&logo=arduino&logoColor=white)](https://arduino.cc)
[![Sarvam AI](https://img.shields.io/badge/Sarvam_AI-sarvam--m-FF6B35?style=for-the-badge)](https://sarvam.ai)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**SARAS is a multilingual AI-powered robot** that combines real-time face tracking, voice control, and a conversational chatbot — all accessible from a browser dashboard over HTTPS.

</div>

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎙️ **Multilingual Voice Control** | Speak in English, Hindi, Hinglish, or 50+ languages |
| 🧠 **AI Chatbot** | Powered by Sarvam AI (`sarvam-m`) with conversation memory |
| 👁️ **Face Tracking** | Follow any person or lock onto a registered face |
| 🎮 **Multiple Control Modes** | Keyboard, virtual joystick, D-pad, physical gamepad, or voice |
| 📡 **Real-time Dashboard** | WebSocket-powered browser UI with live camera feed |
| 🔒 **HTTPS by Default** | Self-signed SSL for secure microphone access on network |

---

## 🏗️ Architecture

```
Browser Dashboard (HTTPS)
        │
        ▼
Flask + Socket.IO (app.py)
        │
   ┌────┴────┐
   │         │
OpenCV    Sarvam AI
(Camera)  (Chatbot)
   │         │
   └────┬────┘
        │
   Arduino (Serial)
   (Motor Control)
```

**Voice Pipeline:**
```
Browser Web Speech API → Intent Detector → Robot Command → Arduino
                                      └→ Chatbot Query → Sarvam AI → Browser TTS
```

---

## ⚙️ Tech Stack

| Layer | Technology |
|---|---|
| Web Server | Flask + Flask-SocketIO |
| Real-time Comms | WebSocket (Socket.IO) |
| Voice Input (STT) | Browser Web Speech API |
| LLM (Chatbot) | Sarvam AI — `sarvam-m` |
| Voice Output (TTS) | Browser `speechSynthesis` |
| Computer Vision | OpenCV 4.9 |
| Face Detection | Haar Cascade |
| Face Recognition | dlib + face-recognition *(optional)* |
| Face Tracking | OpenCV Histogram |
| SSL/HTTPS | Python `cryptography` (self-signed) |
| Hardware | Jetson Nano + Arduino via Serial |

---

## 📁 Project Structure

```
saras/
├── app.py                               # Flask server — main backend
├── chatbot_module.py                    # Sarvam LLM + intent detector
├── Bot_prompt.txt                       # SARAS personality & system prompt
├── requirements.txt                     # Python dependencies
├── haarcascade_frontalface_default.xml  # Face detection cascade
├── robot.ino                            # Arduino sketch (motor + servo + ultrasonic)
├── dlib-19.22.99-cp310-cp310-win_amd64.whl  # dlib wheel for Windows
├── saved_faces/                         # Registered face histograms (.pkl)
├── templates/
│   └── index.html                       # Dashboard UI
└── static/
    ├── style.css                        # Saffron/gold theme
    ├── script.js                        # WebSocket, keyboard, voice, gamepad
    └── animations.js                    # UI animations & state transitions
```

---

## 🔌 Hardware Wiring

### Components Required

| Component | Quantity |
|---|---|
| Arduino Uno / Mega | 1 |
| L298N Motor Driver Module | 1 |
| HC-SR04 Ultrasonic Sensor | 1 |
| Servo Motor (SG90 / MG90S) | 1 |
| DC Motors (for wheels) | 2 |
| 7–12V Battery Pack | 1 |
| Jumper Wires | Several |

---

### L298N Motor Driver

```
      ARDUINO                        L298N MODULE
     ┌─────────┐                   ┌──────────────┐
     │      D3 ├──── ENA ──────────┤ ENA          │
     │      D5 ├──── IN1 ──────────┤ IN1          │
     │      D6 ├──── IN2 ──────────┤ IN2          │
     │      D7 ├──── IN3 ──────────┤ IN3          │
     │      D8 ├──── IN4 ──────────┤ IN4          │
     │     D11 ├──── ENB ──────────┤ ENB          │
     │     GND ├──── GND ──────────┤ GND          │
     └─────────┘                   │              │
                                   │ OUT1 ─────── Motor A (+)
                                   │ OUT2 ─────── Motor A (-)
                                   │ OUT3 ─────── Motor B (+)
                                   │ OUT4 ─────── Motor B (-)
                       7-12V ──────┤ VCC (12V)    │
                        GND ───────┤ GND          │
                                   └──────────────┘
```

| Arduino Pin | L298N Pin | Description |
|---|---|---|
| D3 (PWM) | ENA | Left motor speed control |
| D5 | IN1 | Left motor direction A |
| D6 | IN2 | Left motor direction B |
| D7 | IN3 | Right motor direction A |
| D8 | IN4 | Right motor direction B |
| D11 (PWM) | ENB | Right motor speed control |
| GND | GND | Common ground |

> ⚠️ **Important:** The L298N `VCC (12V)` pin connects to your battery pack (7–12V), **not** Arduino's 5V. The onboard 5V regulator on the L298N can power the Arduino via its 5V output pin.

**Motor direction logic:**

| IN1 | IN2 | Motor A |
|---|---|---|
| LOW | HIGH | Forward |
| HIGH | LOW | Backward |
| LOW | LOW | Stop |

---

### HC-SR04 Ultrasonic Sensor

```
      ARDUINO                     HC-SR04
     ┌─────────┐                ┌──────────┐
     │      5V ├───────────────┤ VCC      │
     │     GND ├───────────────┤ GND      │
     │      D2 ├───── TRIG ────┤ TRIG     │
     │      D4 ├───── ECHO ────┤ ECHO     │
     └─────────┘                └──────────┘
```

| Arduino Pin | HC-SR04 Pin | Description |
|---|---|---|
| 5V | VCC | Power supply |
| GND | GND | Ground |
| D2 | TRIG | Trigger pulse output |
| D4 | ECHO | Echo input |

> The sensor checks distance every 100 ms. If an obstacle is detected within **25 cm**, the robot halts automatically and sends `STOP` over Serial. It sends `CLEAR` when the path is free again.

---

### Servo Motor

```
      ARDUINO                      SERVO MOTOR
     ┌─────────┐                 ┌─────────────────┐
     │      5V ├────────────────┤ Red   (Power)   │
     │     GND ├────────────────┤ Brown (Ground)  │
     │     D12 ├────────────────┤ Orange (Signal) │
     └─────────┘                 └─────────────────┘
```

| Arduino Pin | Servo Wire | Description |
|---|---|---|
| 5V | Red | Power |
| GND | Brown / Black | Ground |
| D12 | Orange / Yellow | PWM signal |

> The servo pans the camera left/right. It centers at **90°** on startup and moves in **10° steps** via serial commands `J` (left) and `L` (right).

---

### Arduino Serial Command Reference

**Manual commands:**

| Command | Action | Serial Response |
|---|---|---|
| `W` / `w` | Move forward *(blocked if obstacle < 25 cm)* | `OK:FORWARD` or `BLOCKED` |
| `S` / `s` | Move backward | `OK:BACKWARD` |
| `A` / `a` | Turn left | `OK:LEFT` |
| `D` / `d` | Turn right | `OK:RIGHT` |
| `X` / `x` | Stop motors | `OK:STOP` |
| `J` / `j` | Servo pan left (−10°) | `ANGLE:<value>` |
| `L` / `l` | Servo pan right (+10°) | `ANGLE:<value>` |
| `C` / `c` | Servo center (90°) | `OK:CENTER` |
| `+` | Increase motor speed (+25) | `SPEED:<value>` |
| `-` | Decrease motor speed (−25) | `SPEED:<value>` |
| `Q` / `q` | Emergency stop | `OK:STOP` |

**Auto-broadcast messages** *(sent by Arduino unprompted):*

| Message | Meaning |
|---|---|
| `DIST:<cm>` | Distance reading every 100 ms |
| `STOP` | Obstacle detected — motors halted |
| `CLEAR` | Path is now clear |
| `READY` | Arduino booted successfully |

---

## 🚀 Quick Start

### Prerequisites

- Python 3.10
- Arduino (flashed with motor control sketch)
- USB Camera
- Sarvam AI API Key

---

### Step 1 — Clone & Configure

```bash
git clone https://github.com/your-username/saras.git
cd saras
```

Create a `.env` file in the project root:

```env
SARVAM_API_KEY=sk_xxxxxxxx_xxxxxxxxxxxxxxxxxx
```

> Get your key from [dashboard.sarvam.ai](https://dashboard.sarvam.ai)

---

### Step 2 — Install Dependencies

### 2.1 🪟 Windows (Python 3.10 x64)

**Step 1 — Install dlib (do this first, mandatory)**

```powershell
pip install https://github.com/z-mahmud22/Dlib_Windows_Python3.x/raw/main/dlib-19.22.99-cp310-cp310-win_amd64.whl
```

> For other Python versions download matching wheel from:
> 👉 https://github.com/z-mahmud22/Dlib_Windows_Python3.x

**Step 2 — Install remaining packages**

```powershell
pip install -r requirements.txt
```

**Step 3 — Verify**

```powershell
python -c "import flask, flask_socketio, serial, cv2, requests, dotenv, numpy, urllib3, dlib, face_recognition; print('All OK ✓')"
```

---

### 2.2 🐧 Linux / Ubuntu / Jetson Nano

**Step 1 — Install system dependencies**

```bash
sudo apt update
sudo apt install cmake build-essential libopenblas-dev liblapack-dev libx11-dev python3-pip libopencv-dev python3-opencv -y
sudo usermod -aG dialout $USER
```

> ⚠️ Log out and back in after `usermod` for serial port access.

**Step 2 — Uncomment dlib in requirements.txt**

Open `requirements.txt` and change this:
```bash
#dlib
```
To this:
```bash
dlib
```
**Step 3 — Install all packages**

```bash
pip3 install -r requirements.txt --break-system-packages
```

> dlib compiles from source automatically — takes 5-10 minutes, this is normal.

**Step 4 — Verify**

```bash
python3 -c "import flask, flask_socketio, serial, cv2, requests, dotenv, numpy, urllib3, dlib, face_recognition; print('All OK ✓')"
```

## 🔌 Arduino Setup

1. Install [Arduino IDE](https://www.arduino.cc/en/software)
2. Open `robot.ino` and click **Upload**
3. Connect Arduino via USB
4. Select **Tools → Board → Arduino Uno**
5. Select **Tools → Port → COM3** (Windows) or **/dev/ttyUSB0** (Linux)
6. Open Serial Monitor — you should see `READY`

> ⚠️ Close Serial Monitor before running `app.py`

---

### Step 3 — Connect Arduino & Find Port

```bash
# Windows
python -c "import serial.tools.list_ports; [print(p.device, '|', p.description) for p in serial.tools.list_ports.comports()]"

# Linux / Jetson
ls /dev/tty*
```

> `app.py` auto-detects the port — no manual configuration needed.

### Step 4 — Verify Camera

```bash
python -c "import cv2; cap=cv2.VideoCapture(0); print('Camera:', 'OK' if cap.isOpened() else 'NOT FOUND'); cap.release()"
```

> USB cameras (index 1, 2, 3) take priority over the laptop camera (index 0).

---

### Step 5 — Run

```bash
python app.py
```

Expected output:

```
============================================================
  🤖 Robot Control Server  —  Starting...
============================================================
[CHATBOT] Sarvam chatbot module loaded ✓
[SERIAL]  Found (COM11): USB-SERIAL CH340
[SERIAL]  Arduino on COM11 — REAL mode.
[HAAR]    Using cascade: .../haarcascade_frontalface_default.xml
[TRACK]   face_recognition available ✓
[SSL]     ✓ Certificate generated for localhost + 192.168.x.x
[SERVER]  Running at https://localhost:5000
[SERVER]  Network:  https://192.168.x.x:5000
```

Open in browser:

```
https://localhost:5000       ← same machine
https://<your-ip>:5000       ← phone / laptop on same WiFi
```

> ⚠️ The browser will show a **"Not Secure"** warning because the SSL certificate is self-signed. Click **Advanced → Proceed**. This is expected and required for microphone access over the network.

---

## 🎮 Controls

### Keyboard

| Key | Action |
|---|---|
| `W` / `↑` | Forward |
| `S` / `↓` | Backward |
| `A` / `←` | Left |
| `D` / `→` | Right |
| `Space` | Stop |

### Virtual Gamepad

- **Joystick** — Drag to move in any direction
- **D-Pad** — Hold to move, release to stop
- **L1 / R1** — Turn left / right
- **Physical Gamepad** — Connect via USB or Bluetooth, press any button to activate

### Voice Commands

Click the 🎤 mic button and speak:

| English | Hindi / Hinglish | Action |
|---|---|---|
| "Forward" | "Aage chalo" | Move forward |
| "Backward" | "Peeche" | Move backward |
| "Left" | "Left mudo" | Turn left |
| "Right" | "Right mudo" | Turn right |
| "Stop" | "Ruko" | Stop |
| "Follow" | "Follow karo" | Start face following |
| "Track" | "Track karo" | Start smart tracking |
| Any question | Koi bhi sawaal | SARAS replies via AI |

---

## 👁️ Face Tracking

### Follow Mode *(any person)*

1. Click **FOLLOW PERSON** — camera activates automatically
2. SARAS follows the largest detected face
3. Click again to stop

### Smart Tracking *(specific person)*

1. Stand in front of the camera
2. Click **REGISTER TARGET** → enter your name → ✓ **SAVE**
3. Face is saved to `saved_faces/yourname.pkl`
4. Click **START TRACKING** — SARAS tracks only you
5. Click **STOP TRACKING** to end

### Loading a Previously Saved Face

1. Open the **SAVED FACES** panel
2. Click **LOAD** next to a name
3. Click **START TRACKING** — no re-registration needed

### Recognition Accuracy

| Mode | Requirement | Accuracy |
|---|---|---|
| Size-based | OpenCV only | Follows largest face |
| Histogram-based *(default)* | OpenCV | ~85% |
| Face encoding | dlib + face-recognition | ~99% |

---

## 🪷 SARAS Chatbot

SARAS uses **Sarvam AI (`sarvam-m`)** with automatic language detection and **10-message conversation memory**.

**Supported languages:** English, Hindi (Devanagari), Hinglish (Roman script), Arabic, Chinese, Japanese, Korean, Tamil, Telugu, Bengali, and 40+ more.

**Example conversations:**

```
You:   "SARAS, kaun ho tum?"
SARAS: [replies in Hindi]

You:   "What can you do?"
SARAS: [replies in English]

You:   "Mujhe robotics ke baare mein batao"
SARAS: [replies in Hinglish]
```

---

## 🌐 API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Dashboard UI |
| `/api/command` | POST | Send movement command |
| `/api/state` | GET | Get robot state |
| `/api/log` | GET | Command history |
| `/api/camera` | POST | Start / stop camera |
| `/api/face_detection` | POST | Toggle face following |
| `/api/register_target` | POST | Register face with name |
| `/api/smart_track` | POST | Toggle smart tracking |
| `/api/faces` | GET | List saved faces |
| `/api/load_face` | POST | Load saved face |
| `/api/delete_face` | POST | Delete saved face |
| `/api/intent` | POST | Detect voice intent |
| `/api/chat` | POST | Chat with SARAS |
| `/api/chat/clear` | POST | Clear chat memory |
| `/video_feed` | GET | MJPEG live camera stream |

---

## 🔧 Troubleshooting

| Problem | Solution |
|---|---|
| `SARVAM_API_KEY` not set | Create `.env` with your key |
| Serial in MOCK mode | Check Arduino connection and port detection |
| Bluetooth port detected | Auto-skipped; check Device Manager if issue persists |
| Camera not found | Run camera test command, check USB connection |
| Camera timeout | USB cameras may take 5–10 s to open — wait |
| Voice not working | Use `https://`, not `http://`; allow mic in browser |
| Browser security warning | Click **Advanced → Proceed** (self-signed cert) |
| API error 404 | Verify `SARVAM_API_KEY` in `.env` |
| `<think>` tags in reply | Fixed in `chatbot_module.py` — update to latest |
| dlib install error (Windows) | Use the prebuilt `.whl` — see Step 2 |
| numpy compile error | Pin to `numpy==1.26.4` for Python 3.10 |
| Module not found | Run `pip install -r requirements.txt` |

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create your branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**SARAS — Saraswati AI Robot Autonomous System**

*Built with Flask · OpenCV · Sarvam AI · Arduino · dlib*

</div>
