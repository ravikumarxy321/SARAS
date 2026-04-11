"""
Robot Control Backend - Flask Application
==========================================
Runs on Jetson Nano (Ubuntu Linux)
Communicates with Arduino via Serial
"""

from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO, emit
import serial
import threading
import time
import json
import os
import sys
from dotenv import load_dotenv
load_dotenv()

# ── SARAS Chatbot (Sarvam LLM) ───────────────────────────────────────────────
try:
    from chatbot_module import get_chatbot, detect_intent
    CHATBOT_AVAILABLE = True
    print("[CHATBOT] Sarvam chatbot module loaded ✓")
except Exception as e:
    CHATBOT_AVAILABLE = False
    print(f"[CHATBOT] Not available: {e}")

try:
    import cv2
    CV_AVAILABLE = True
except ImportError:
    CV_AVAILABLE = False
    print("[WARNING] OpenCV not installed. Face detection disabled.")

# ─── Flask + SocketIO Setup ───────────────────────────────────────────────────
app = Flask(__name__)

_secret = os.environ.get('SECRET_KEY')
if not _secret:
    raise RuntimeError("SECRET_KEY not set in .env — add it before starting.")
app.config['SECRET_KEY'] = _secret

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# ─── Serial Configuration ─────────────────────────────────────────────────────
BAUD_RATE = 9600

def _auto_detect_port():
    import serial.tools.list_ports
    ports = list(serial.tools.list_ports.comports())
    SKIP = ['bluetooth','bthenum','standard serial over bluetooth','wireless','virtual','vmware','hyper-v']
    def _skip(p):
        d = (p.description or '').lower(); h = (p.hwid or '').lower()
        return any(s in d or s in h for s in SKIP)
    for p in ports:
        if _skip(p): continue
        if any(x in p.device for x in ['ttyACM','ttyUSB','usbmodem']):
            print(f"[SERIAL] Found ({p.device}): {p.description}"); return p.device
    for p in ports:
        if _skip(p): continue
        d = (p.description or '').lower(); h = (p.hwid or '').lower()
        if any(x in d or x in h for x in ['arduino','ch340','cp210','ftdi','usb-serial','usb serial']):
            print(f"[SERIAL] Found ({p.device}): {p.description}"); return p.device
    for p in ports:
        if _skip(p): continue
        if 'COM' in p.device and p.device.strip() != 'COM1':
            print(f"[SERIAL] Found ({p.device}): {p.description}"); return p.device
    print("[SERIAL] No Arduino found — MOCK mode."); return None

SERIAL_PORT = _auto_detect_port()
SERIAL_MOCK = (SERIAL_PORT is None)
if SERIAL_MOCK: print("[SERIAL] No Arduino — MOCK mode.")
else: print(f"[SERIAL] Arduino on {SERIAL_PORT} — REAL mode.")

# ─── Global State ─────────────────────────────────────────────────────────────
robot_state = {
    "status":           "IDLE",
    "direction":        "STOPPED",
    "face_detection":   False,
    "obstacle":         False,
    "last_command":     "None",
    "battery":          87,
    "signal_strength":  94,
    "uptime":           0,
}
command_log  = []
ser          = None
face_thread  = None
face_running = False
start_time   = time.time()


# ══════════════════════════════════════════════════════════════════════════════
# SERIAL COMMUNICATION
# ══════════════════════════════════════════════════════════════════════════════
def init_serial():
    global ser, SERIAL_MOCK
    if SERIAL_MOCK:
        print("[SERIAL] Mock mode — no Arduino required.")
        return True
    if not SERIAL_PORT:
        print("[SERIAL] No port — switching to mock mode.")
        SERIAL_MOCK = True
        return False
    try:
        ser = serial.Serial(SERIAL_PORT.strip(), BAUD_RATE, timeout=1)
        time.sleep(2)
        print(f"[SERIAL] ✓ Connected: {SERIAL_PORT.strip()} @ {BAUD_RATE} baud")
        return True
    except serial.SerialException as e:
        print(f"[SERIAL ERROR] {e}")
        print("[SERIAL] Falling back to mock mode.")
        SERIAL_MOCK = True
        return False


# Arduino sketch uses W/S/A/D/X — map from internal F/B/L/R/S
_CMD_MAP = {'F':'W', 'B':'S', 'L':'A', 'R':'D', 'S':'X'}

def send_serial(cmd: str):
    global ser
    arduino_cmd = _CMD_MAP.get(cmd, cmd)
    if SERIAL_MOCK:
        print(f"[MOCK] {cmd} → {arduino_cmd}")
        return True
    if ser and ser.is_open:
        ser.write(arduino_cmd.encode())
        print(f"[SERIAL] {cmd} → {arduino_cmd}")
        return True
    print("[SERIAL] Not connected.")
    return False


# ══════════════════════════════════════════════════════════════════════════════
# TTS — browser handles it
# ══════════════════════════════════════════════════════════════════════════════
def init_tts():
    print("[TTS] Browser-based TTS (Google speechSynthesis) — no server TTS needed.")

def speak(text: str):
    print(f"[TTS] → browser: {text[:60]}...")


# ══════════════════════════════════════════════════════════════════════════════
# MOVEMENT COMMANDS
# ══════════════════════════════════════════════════════════════════════════════
COMMAND_MAP = {
    'F': {'direction': 'FORWARD',  'label': 'Moving Forward'},
    'B': {'direction': 'BACKWARD', 'label': 'Moving Backward'},
    'L': {'direction': 'LEFT',     'label': 'Turning Left'},
    'R': {'direction': 'RIGHT',    'label': 'Turning Right'},
    'S': {'direction': 'STOPPED',  'label': 'Stopped'},
}

def execute_command(cmd: str, source: str = "API"):
    cmd = cmd.upper().strip()
    if cmd not in COMMAND_MAP:
        return {"success": False, "error": f"Unknown command: {cmd}"}
    info = COMMAND_MAP[cmd]
    ok   = send_serial(cmd)
    robot_state['direction']    = info['direction']
    robot_state['last_command'] = cmd
    robot_state['status']       = 'MOVING' if cmd != 'S' else 'IDLE'
    entry = {
        "time":    time.strftime("%H:%M:%S"),
        "command": cmd,
        "label":   info['label'],
        "source":  source,
        "success": ok,
    }
    command_log.insert(0, entry)
    if len(command_log) > 50:
        command_log.pop()
    socketio.emit('state_update',   robot_state)
    socketio.emit('command_logged', entry)
    return {"success": ok, "direction": info['direction'], "label": info['label']}


# ══════════════════════════════════════════════════════════════════════════════
# SHARED CAMERA MANAGER
# ══════════════════════════════════════════════════════════════════════════════
import cv2 as _cv2
import numpy as _np

_shared_cap        = None
_shared_cap_lock   = threading.Lock()
_latest_frame      = None
_latest_frame_lock = threading.Lock()
_cam_thread_active = False

# ── Haar Cascade — works on Windows + Linux + Jetson automatically ────────────
_HAAR_PATH    = os.path.join(_cv2.data.haarcascades, 'haarcascade_frontalface_default.xml')
print("[HAAR] Using cascade:", _HAAR_PATH)
_face_cascade = _cv2.CascadeClassifier(_HAAR_PATH)


def _camera_reader_thread():
    global _shared_cap, _latest_frame, _cam_thread_active
    print("[CAM] Reader thread started")

    # ── Camera Priority: USB external first, laptop builtin as fallback ─────
    # USB camera = index 1+ (real robot camera)
    # Laptop builtin = index 0 (mock/test mode)
    cap = None
    cam_mode = None

    # Pass 1: Try USB/external camera (index 1, 2, 3)
    for idx in range(0, 4):
        if os.name == 'nt':
            test = _cv2.VideoCapture(idx, _cv2.CAP_DSHOW)
        else:
            test = _cv2.VideoCapture(idx)
        if test.isOpened():
            ret, _ = test.read()
            if ret:
                cap = test
                cam_mode = f"USB camera (index {idx})"
                print(f"[CAM] ✓ USB camera found at index {idx} — REAL mode")
                break
            test.release()
        else:
            test.release()

    # Pass 2: Fallback to laptop builtin camera (index 0) — mock/test mode
    if cap is None:
        if os.name == 'nt':
            test = _cv2.VideoCapture(0, _cv2.CAP_DSHOW)
        else:
            test = _cv2.VideoCapture(0)
        if test.isOpened():
            ret, _ = test.read()
            if ret:
                cap = test
                cam_mode = "Laptop builtin camera (index 0) — TEST/MOCK mode"
                print("[CAM] ⚠ No USB camera — using laptop camera for testing")
            else:
                test.release()

    if cap is None or not cap.isOpened():
        print("[CAM] ERROR: No camera found!")
        _cam_thread_active = False
        return

    print(f"[CAM] Using: {cam_mode}")

    cap.set(_cv2.CAP_PROP_FRAME_WIDTH,  640)
    cap.set(_cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(_cv2.CAP_PROP_FPS,          30)
    cap.set(_cv2.CAP_PROP_BUFFERSIZE,   1)

    # Warm up — read first frame
    for _ in range(5):
        cap.read()

    print("[CAM] Camera ready — 640x480 @ 30fps")

    with _shared_cap_lock:
        _shared_cap = cap

    while _cam_thread_active:
        ret, frame = cap.read()
        if ret:
            with _latest_frame_lock:
                _latest_frame = frame.copy()
        else:
            time.sleep(0.01)
    cap.release()
    with _shared_cap_lock:
        _shared_cap = None
    print("[CAM] Reader thread stopped")


_cam_thread_ref = None   # keep reference to check if thread is alive

def start_camera_reader():
    global _cam_thread_active, _cam_thread_ref, _latest_frame
    # If thread is dead or never started — restart it
    if _cam_thread_ref is not None and not _cam_thread_ref.is_alive():
        print("[CAM] Thread was dead — restarting...")
        _cam_thread_active = False
        _cam_thread_ref    = None
        _latest_frame      = None   # reset frame
    if not _cam_thread_active:
        _cam_thread_active = True
        _cam_thread_ref    = threading.Thread(target=_camera_reader_thread, daemon=True)
        _cam_thread_ref.start()
        print("[CAM] Camera thread launching...")
    else:
        print("[CAM] Camera thread already running")

def stop_camera_reader():
    global _cam_thread_active
    _cam_thread_active = False

def get_latest_frame():
    with _latest_frame_lock:
        if _latest_frame is not None:
            return True, _latest_frame.copy()
    return False, None


def generate_frames():
    no_cam_frame = _np.zeros((480, 640, 3), dtype='uint8')
    _cv2.putText(no_cam_frame, 'STARTING CAMERA...', (140, 230),
                 _cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 160, 0), 2)
    _cv2.putText(no_cam_frame, 'Please wait', (220, 270),
                 _cv2.FONT_HERSHEY_SIMPLEX, 0.6, (150, 100, 0), 1)
    while True:
        ret, frame = get_latest_frame()
        if not ret:
            frame = no_cam_frame.copy()
        else:
            if face_running:
                gray  = _cv2.cvtColor(frame, _cv2.COLOR_BGR2GRAY)
                faces = _face_cascade.detectMultiScale(
                    gray, scaleFactor=1.1, minNeighbors=5, minSize=(50, 50))
                for (x, y, w, h) in faces:
                    _cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 180, 255), 2)
                    _cv2.putText(frame, 'FACE', (x, y-8),
                                 _cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 180, 255), 2)
                    _cv2.circle(frame, (x+w//2, y+h//2), 4, (0, 255, 150), -1)
            status = f"SARAS | {robot_state['direction']}"
            _cv2.putText(frame, status, (8, 22),
                         _cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 160, 0), 2)
            fh, fw = frame.shape[:2]
            mx, my = fw//2, fh//2
            _cv2.line(frame, (mx-15, my), (mx+15, my), (80, 80, 80), 1)
            _cv2.line(frame, (mx, my-15), (mx, my+15), (80, 80, 80), 1)
        ok, buf = _cv2.imencode('.jpg', frame, [_cv2.IMWRITE_JPEG_QUALITY, 65])
        if not ok:
            continue
        yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n')
        time.sleep(0.033)


@app.route('/video_feed')
def video_feed():
    from flask import Response
    start_camera_reader()
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/camera', methods=['POST'])
def api_camera():
    data = request.get_json(force=True)
    enable = data.get('enable', True)
    if enable:
        start_camera_reader()
        socketio.emit('camera_status', {'active': True})
    else:
        stop_camera_reader()
        socketio.emit('camera_status', {'active': False})
    return jsonify({"success": True, "camera_active": enable})


# ══════════════════════════════════════════════════════════════════════════════
# FACE DETECTION
# ══════════════════════════════════════════════════════════════════════════════
def face_detection_loop():
    global face_running
    if not CV_AVAILABLE:
        socketio.emit('face_status', {'active': False, 'error': 'OpenCV not available'})
        return

    # Start camera + keep retrying until frame arrives or user stops
    start_camera_reader()
    print("[FACE] Waiting for camera...")
    waited = 0
    while face_running:
        ret, frame = get_latest_frame()
        if ret:
            print("[FACE] Camera ready — starting detection")
            break
        waited += 1
        if waited % 20 == 0:
            print(f"[FACE] Still waiting for camera... ({waited//10}s) — retrying")
            start_camera_reader()
        time.sleep(0.1)
    if not face_running:
        return   # user stopped before camera ready

    CENTER_X  = 320
    TOLERANCE = 80
    while face_running:
        ret, frame = get_latest_frame()
        if not ret or frame is None:
            time.sleep(0.1)
            continue
        # Validate frame
        if frame.size == 0 or len(frame.shape) < 2:
            time.sleep(0.1)
            continue
        try:
            gray  = _cv2.cvtColor(frame, _cv2.COLOR_BGR2GRAY)
            faces = _face_cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(50, 50))
            if len(faces) > 0:
                x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
                face_cx = x + w // 2
                offset  = face_cx - CENTER_X
                cmd = 'F' if abs(offset) < TOLERANCE else ('L' if offset < 0 else 'R')
                execute_command(cmd, source="FaceDetection")
                socketio.emit('face_detected', {
                    'x': int(x), 'y': int(y),
                    'width': int(w), 'height': int(h),
                    'offset': int(offset),
                })
            else:
                execute_command('S', source="FaceDetection")
                socketio.emit('face_lost', {})
        except Exception as e:
            print(f"[FACE] Frame error: {e} — skipping")
            time.sleep(0.1)
            continue
        time.sleep(0.1)
    face_running = False
    socketio.emit('face_status', {'active': False})


# ══════════════════════════════════════════════════════════════════════════════
# OBSTACLE DETECTION
# ══════════════════════════════════════════════════════════════════════════════
def obstacle_monitor():
    while True:
        if ser and ser.is_open and not SERIAL_MOCK:
            try:
                if ser.in_waiting:
                    data = ser.readline().decode(errors='ignore').strip()
                    if not data:
                        time.sleep(0.05); continue
                    if data in ('STOP','BLOCKED','O'):
                        if not robot_state['obstacle']:
                            robot_state['obstacle'] = True
                            socketio.emit('obstacle_detected', {})
                            execute_command('S', source='ObstacleSensor')
                    elif data == 'CLEAR':
                        if robot_state['obstacle']:
                            robot_state['obstacle'] = False
                            socketio.emit('obstacle_cleared', {})
                    elif data.startswith('DIST:'):
                        try:
                            dist = int(data.split(':')[1])
                            socketio.emit('distance_update', {'distance': dist})
                        except: pass
            except Exception:
                pass
        time.sleep(0.05)


# ══════════════════════════════════════════════════════════════════════════════
# UPTIME TICKER
# ══════════════════════════════════════════════════════════════════════════════
def uptime_ticker():
    while True:
        robot_state['uptime'] = int(time.time() - start_time)
        socketio.emit('uptime', {'seconds': robot_state['uptime']})
        time.sleep(1)


# ══════════════════════════════════════════════════════════════════════════════
# FLASK ROUTES
# ══════════════════════════════════════════════════════════════════════════════
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/command', methods=['POST'])
def api_command():
    data = request.get_json(force=True)
    return jsonify(execute_command(data.get('command','').upper(), data.get('source','API')))

@app.route('/api/state', methods=['GET'])
def api_state():
    return jsonify(robot_state)

@app.route('/api/log', methods=['GET'])
def api_log():
    return jsonify(command_log[:20])

@app.route('/api/introduce', methods=['POST'])
def api_introduce():
    intro = ("Hello! I am SARAS, an AI powered robot. "
             "I can move using voice commands, keyboard control, or a game controller. "
             "I can detect obstacles and avoid them automatically. "
             "I can also detect and follow a human face using my camera. "
             "It is great to meet you!")
    speak(intro)
    socketio.emit('robot_speaking', {'text': intro, 'active': True})
    def end_speaking():
        time.sleep(7)
        socketio.emit('robot_speaking', {'text': '', 'active': False})
    threading.Thread(target=end_speaking, daemon=True).start()
    return jsonify({"success": True, "message": intro})

@app.route('/api/face_detection', methods=['POST'])
def api_face_detection():
    global face_thread, face_running
    data   = request.get_json(force=True)
    enable = data.get('enable', False)
    if enable and not face_running:
        face_running = True
        robot_state['face_detection'] = True
        face_thread = threading.Thread(target=face_detection_loop, daemon=True)
        face_thread.start()
        socketio.emit('face_status', {'active': True})
        print("[FACE] Detection STARTED")
        return jsonify({"success": True, "message": "Face detection started"})
    elif not enable:
        face_running = False
        robot_state['face_detection'] = False
        execute_command('S', source='FaceDetection')
        socketio.emit('face_status', {'active': False})
        print("[FACE] Detection STOPPED")
        return jsonify({"success": True, "message": "Face detection stopped"})
    return jsonify({"success": False, "message": "Already in requested state"})

@app.route('/api/voice_command', methods=['POST'])
def api_voice_command():
    data = request.get_json(force=True)
    text = data.get('text', '').lower()
    KEYWORD_MAP = {
        ('forward', 'ahead', 'go'):              'F',
        ('backward', 'back', 'reverse'):         'B',
        ('left', 'turn left'):                   'L',
        ('right', 'turn right'):                 'R',
        ('stop', 'halt', 'freeze', 'standby'):   'S',
    }
    for keywords, cmd in KEYWORD_MAP.items():
        if any(kw in text for kw in keywords):
            result = execute_command(cmd, source="Voice")
            return jsonify({**result, "recognized_text": text})
    return jsonify({"success": False, "recognized_text": text, "error": "No command recognized"})


# ══════════════════════════════════════════════════════════════════════════════
# CHATBOT ROUTES
# ══════════════════════════════════════════════════════════════════════════════
@app.route('/api/chat', methods=['POST'])
def api_chat():
    if not CHATBOT_AVAILABLE:
        return jsonify({"success": False, "reply": "Chatbot not available. Check SARVAM_API_KEY in .env"})
    data    = request.get_json(force=True)
    message = data.get('message', '').strip()
    if not message:
        return jsonify({"success": False, "reply": "Empty message."})
    try:
        reply = get_chatbot().chat(message)
        socketio.emit('chat_message', {'role': 'assistant', 'text': reply, 'speak': True})
        return jsonify({"success": True, "reply": reply})
    except Exception as e:
        return jsonify({"success": False, "reply": f"Error: {str(e)}"})

@app.route('/api/intent', methods=['POST'])
def api_intent():
    if not CHATBOT_AVAILABLE:
        return jsonify({"type": "chat"})
    data = request.get_json(force=True)
    return jsonify(detect_intent(data.get('text', '')))

@app.route('/api/chat/clear', methods=['POST'])
def api_chat_clear():
    if CHATBOT_AVAILABLE:
        get_chatbot().clear_memory()
    return jsonify({"success": True})


# ══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET EVENTS
# ══════════════════════════════════════════════════════════════════════════════
@socketio.on('connect')
def on_connect():
    print("[WS] Client connected")
    emit('state_update', robot_state)
    emit('log_history', command_log[:20])

@socketio.on('disconnect')
def on_disconnect():
    print("[WS] Client disconnected")

@socketio.on('command')
def on_ws_command(data):
    result = execute_command(data.get('command','').upper(), data.get('source','WebSocket'))
    emit('command_result', result)

@socketio.on('sync_action')
def on_sync_action(data):
    print(f"[SYNC] Broadcasting: {data}")
    emit('sync_action', data, broadcast=True, include_self=False)

@socketio.on('request_full_sync')
def on_request_full_sync():
    emit('state_update', robot_state)
    emit('log_history', command_log[:20])
    print("[SYNC] Full state sent to new device")


# ══════════════════════════════════════════════════════════════════════════════
# SMART PERSON TRACKING
# ══════════════════════════════════════════════════════════════════════════════
import subprocess
import math

try:
    import face_recognition
    FACE_RECOG_AVAILABLE = True
    print("[TRACK] face_recognition available ✓")
except ImportError:
    FACE_RECOG_AVAILABLE = False
    print("[TRACK] face_recognition not installed — using size-based tracking")

SERVO_CENTER  = 90
SERVO_MIN     = 30
SERVO_MAX     = 150
SERVO_STEP    = 15
servo_angle   = SERVO_CENTER

target_encoding   = None
target_registered = False
target_name       = None   # name of currently tracked person
smart_track_active = False
smart_track_thread = None
bypass_active      = False

# ── Face storage directory ────────────────────────────────────────────────────
import pickle
FACES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'saved_faces')
os.makedirs(FACES_DIR, exist_ok=True)

def save_face(name: str, encoding) -> bool:
    """Save face encoding/histogram to disk with person's name."""
    try:
        safe_name = name.strip().lower().replace(' ', '_')
        path = os.path.join(FACES_DIR, f'{safe_name}.pkl')
        with open(path, 'wb') as f:
            pickle.dump({'name': name.strip(), 'encoding': encoding}, f)
        print(f"[FACE SAVE] ✓ Saved: {name} → {path}")
        return True
    except Exception as e:
        print(f"[FACE SAVE] Error: {e}")
        return False

def load_face(name: str):
    """Load face encoding by name. Returns (name, encoding) or (None, None)."""
    try:
        safe_name = name.strip().lower().replace(' ', '_')
        path = os.path.join(FACES_DIR, f'{safe_name}.pkl')
        if not os.path.exists(path):
            return None, None
        with open(path, 'rb') as f:
            data = pickle.load(f)
        print(f"[FACE LOAD] ✓ Loaded: {data['name']}")
        return data['name'], data['encoding']
    except Exception as e:
        print(f"[FACE LOAD] Error: {e}")
        return None, None

def list_saved_faces():
    """List all saved face names."""
    faces = []
    for f in os.listdir(FACES_DIR):
        if f.endswith('.pkl'):
            try:
                path = os.path.join(FACES_DIR, f)
                with open(path, 'rb') as fp:
                    data = pickle.load(fp)
                faces.append(data['name'])
            except: pass
    return sorted(faces)

def delete_face(name: str) -> bool:
    """Delete a saved face by name."""
    try:
        safe_name = name.strip().lower().replace(' ', '_')
        path = os.path.join(FACES_DIR, f'{safe_name}.pkl')
        if os.path.exists(path):
            os.remove(path)
            print(f"[FACE DELETE] ✓ Deleted: {name}")
            return True
        return False
    except Exception as e:
        print(f"[FACE DELETE] Error: {e}")
        return False

FRAME_W   = 640
FRAME_H   = 480
CENTER_X  = FRAME_W // 2
TOLERANCE = 60


def servo_move(angle):
    global servo_angle
    angle       = max(SERVO_MIN, min(SERVO_MAX, int(angle)))
    servo_angle = angle
    cmd_str     = f"V{angle:03d}"
    if not SERIAL_MOCK and ser and ser.is_open:
        ser.write(cmd_str.encode())
    print(f"[SERVO] → {angle}°")
    socketio.emit('servo_angle', {'angle': angle})

def servo_center():
    servo_move(SERVO_CENTER)

def beep_alert(times=2):
    def _beep():
        for _ in range(times):
            try:
                subprocess.run(['sox','-n','-t','alsa','default','synth','0.2','sine','880'],
                               capture_output=True, timeout=1)
            except Exception:
                print("\a", end="", flush=True)
            time.sleep(0.1)
    threading.Thread(target=_beep, daemon=True).start()

def _extract_face_histogram(frame, x, y, w, h):
    """Extract color histogram from face region — used as face signature."""
    face_roi = frame[y:y+h, x:x+w]
    if face_roi.size == 0:
        return None
    hsv = _cv2.cvtColor(face_roi, _cv2.COLOR_BGR2HSV)
    # H: 0-180, S: 0-256 — ignore V (lighting changes)
    hist = _cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
    _cv2.normalize(hist, hist, 0, 1, _cv2.NORM_MINMAX)
    return hist

def _compare_histograms(hist1, hist2):
    """Compare two histograms — returns similarity 0.0-1.0 (1.0 = identical)."""
    if hist1 is None or hist2 is None:
        return 0.0
    return _cv2.compareHist(hist1, hist2, _cv2.HISTCMP_CORREL)

def register_target_person(name: str = 'Target'):
    global target_encoding, target_registered, target_name
    # Auto-start camera + wait for frame (max 10s)
    start_camera_reader()
    for i in range(100):
        ret, frame = get_latest_frame()
        if ret: break
        if i % 10 == 0: start_camera_reader()  # retry if thread died
        time.sleep(0.1)
    else:
        print("[TRACK] No frame — check USB camera")
        return False
    ret, frame = get_latest_frame()
    if not ret:
        return False

    encoding = None

    if FACE_RECOG_AVAILABLE:
        rgb       = frame[:, :, ::-1]
        locations = face_recognition.face_locations(rgb, model='hog')
        if not locations:
            print("[TRACK] No face found in frame")
            return False
        largest   = max(locations, key=lambda loc: (loc[2]-loc[0]) * (loc[1]-loc[3]))
        encodings = face_recognition.face_encodings(rgb, [largest])
        if encodings:
            encoding = encodings[0]
            method   = 'face_recognition'
        else:
            return False
    else:
        gray  = _cv2.cvtColor(frame, _cv2.COLOR_BGR2GRAY)
        faces = _face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(60, 60))
        if len(faces) == 0:
            print("[TRACK] No face found — move closer to camera")
            return False
        largest = max(faces, key=lambda f: f[2] * f[3])
        x, y, w, h = largest
        encoding = _extract_face_histogram(frame, x, y, w, h)
        if encoding is None:
            return False
        method = 'opencv_histogram'

    # Set as current target
    target_encoding   = encoding
    target_registered = True
    target_name       = name.strip()

    # Save to disk
    save_face(target_name, encoding)

    print(f"[TRACK] ✓ '{target_name}' registered via {method}!")
    socketio.emit('target_registered', {
        'success': True,
        'method':  method,
        'name':    target_name,
    })
    return True

def find_target_in_frame(frame):
    gray  = _cv2.cvtColor(frame, _cv2.COLOR_BGR2GRAY)
    faces = _face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(50, 50))
    if len(faces) == 0:
        return False, 0, 0, 0, 0
    if FACE_RECOG_AVAILABLE and target_encoding is not None and not isinstance(target_encoding, _np.ndarray):
        rgb       = frame[:, :, ::-1]
        locations = [(y, x+w, y+h, x) for (x,y,w,h) in faces]
        encodings = face_recognition.face_encodings(rgb, locations)
        distances = face_recognition.face_distance(encodings, target_encoding)
        if len(distances) == 0:
            return False, 0, 0, 0, 0
        best_idx = int(_np.argmin(distances))
        if distances[best_idx] < 0.55:
            x, y, w, h = faces[best_idx]
            return True, int(x), int(y), int(w), int(h)
        return False, 0, 0, 0, 0
    elif target_encoding is not None:
        # ── Histogram matching — find registered person ───────────────────
        SIMILARITY_THRESHOLD = 0.55   # 0.0-1.0, higher = stricter match
        best_score = -1
        best_face  = None
        for (x, y, w, h) in faces:
            hist  = _extract_face_histogram(frame, x, y, w, h)
            score = _compare_histograms(target_encoding, hist)
            if score > best_score:
                best_score = score
                best_face  = (x, y, w, h)
        if best_score >= SIMILARITY_THRESHOLD and best_face is not None:
            x, y, w, h = best_face
            return True, int(x), int(y), int(w), int(h)
        return False, 0, 0, 0, 0
    else:
        x, y, w, h = max(faces, key=lambda f: f[2]*f[3])
        return True, int(x), int(y), int(w), int(h)

def bypass_obstacle():
    global bypass_active
    bypass_active = True
    print("[BYPASS] Obstacle! Attempting bypass...")
    socketio.emit('bypass_started', {})
    beep_alert(times=3)
    execute_command('S', source='ObstacleBypass'); time.sleep(0.4)
    execute_command('R', source='ObstacleBypass'); time.sleep(0.6)
    execute_command('F', source='ObstacleBypass'); time.sleep(0.8)
    execute_command('L', source='ObstacleBypass'); time.sleep(0.5)
    execute_command('F', source='ObstacleBypass'); time.sleep(0.6)
    execute_command('S', source='ObstacleBypass')
    bypass_active = False
    socketio.emit('bypass_done', {})
    print("[BYPASS] Bypass complete — resuming tracking")

def scan_for_target():
    print("[SCAN] Scanning for target person...")
    socketio.emit('scan_started', {})
    scan_positions = (
        list(range(SERVO_CENTER, SERVO_MAX, SERVO_STEP)) +
        list(range(SERVO_MAX, SERVO_MIN, -SERVO_STEP)) +
        list(range(SERVO_MIN, SERVO_CENTER, SERVO_STEP))
    )
    for angle in scan_positions:
        if not smart_track_active:
            break
        servo_move(angle)
        time.sleep(0.25)
        ret, frame = get_latest_frame()
        if not ret:
            continue
        found, x, y, w, h = find_target_in_frame(frame)
        if found:
            print(f"[SCAN] Target found at servo angle {angle}°!")
            socketio.emit('scan_found', {'angle': angle})
            return True
    servo_center()
    socketio.emit('scan_lost', {})
    print("[SCAN] Target not found after full sweep")
    return False

def smart_tracking_loop():
    global smart_track_active, bypass_active, servo_angle
    print("[TRACK] Smart tracking loop started")
    lost_count    = 0
    LOST_PATIENCE = 10
    while smart_track_active:
        if bypass_active:
            time.sleep(0.1)
            continue
        ret, frame = get_latest_frame()
        if not ret:
            time.sleep(0.1)
            continue
        found, x, y, w, h = find_target_in_frame(frame)
        if not found:
            lost_count += 1
            execute_command('S', source='SmartTrack')
            if lost_count >= LOST_PATIENCE:
                lost_count = 0
                socketio.emit('target_lost', {})
                print("[TRACK] Target lost — scanning...")
                scan_for_target()
            continue
        lost_count = 0
        face_cx  = x + w // 2
        offset_x = face_cx - CENTER_X
        servo_adjust = int(offset_x / (FRAME_W / 2) * SERVO_STEP * 1.5)
        servo_move(servo_angle - servo_adjust)
        if abs(offset_x) > TOLERANCE * 2:
            cmd = 'L' if offset_x < 0 else 'R'
        elif abs(offset_x) <= TOLERANCE:
            cmd = 'F'
        else:
            cmd = 'L' if offset_x < 0 else 'R'
        if robot_state.get('obstacle', False) and cmd == 'F':
            beep_alert(times=2)
            threading.Thread(target=bypass_obstacle, daemon=True).start()
            time.sleep(0.1)
            continue
        execute_command(cmd, source='SmartTrack')
        socketio.emit('smart_track_update', {
            'found': True, 'face_x': x, 'face_y': y,
            'face_w': w, 'face_h': h,
            'offset_x': int(offset_x), 'servo': servo_angle, 'command': cmd,
        })
        time.sleep(0.08)
    execute_command('S', source='SmartTrack')
    servo_center()
    smart_track_active = False
    print("[TRACK] Smart tracking stopped")


@app.route('/api/register_target', methods=['POST'])
def api_register_target():
    data    = request.get_json(force=True) or {}
    name    = data.get('name', 'Target').strip() or 'Target'
    success = register_target_person(name)
    if success:
        return jsonify({"success": True, "message": f"'{name}' registered!", "name": name})
    return jsonify({"success": False, "message": "No face found. Try again."})

@app.route('/api/faces', methods=['GET'])
def api_list_faces():
    """List all saved faces."""
    return jsonify({"success": True, "faces": list_saved_faces()})

@app.route('/api/load_face', methods=['POST'])
def api_load_face():
    """Load a saved face as current tracking target."""
    global target_encoding, target_registered, target_name
    data = request.get_json(force=True) or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({"success": False, "message": "Name required."})
    loaded_name, encoding = load_face(name)
    if encoding is None:
        return jsonify({"success": False, "message": f"'{name}' not found in saved faces."})
    target_encoding   = encoding
    target_registered = True
    target_name       = loaded_name
    print(f"[TRACK] ✓ Loaded '{loaded_name}' as tracking target")
    socketio.emit('target_registered', {'success': True, 'name': loaded_name, 'method': 'loaded'})
    return jsonify({"success": True, "message": f"'{loaded_name}' loaded!", "name": loaded_name})

@app.route('/api/delete_face', methods=['POST'])
def api_delete_face():
    """Delete a saved face."""
    data    = request.get_json(force=True) or {}
    name    = data.get('name', '').strip()
    success = delete_face(name)
    return jsonify({"success": success, "message": f"'{name}' deleted." if success else "Not found."})

@app.route('/api/smart_track', methods=['POST'])
def api_smart_track():
    global smart_track_active, smart_track_thread
    data   = request.get_json(force=True)
    enable = data.get('enable', False)
    if enable:
        if not target_registered:
            return jsonify({"success": False, "message": "Please register target person first!"})
        if not smart_track_active:
            smart_track_active = True
            start_camera_reader()
            smart_track_thread = threading.Thread(target=smart_tracking_loop, daemon=True)
            smart_track_thread.start()
            socketio.emit('smart_track_status', {'active': True})
            return jsonify({"success": True, "message": "Smart tracking started"})
    else:
        smart_track_active = False
        socketio.emit('smart_track_status', {'active': False})
        return jsonify({"success": True, "message": "Smart tracking stopped"})
    return jsonify({"success": False, "message": "Already running"})

@app.route('/api/servo', methods=['POST'])
def api_servo():
    data = request.get_json(force=True)
    servo_move(data.get('angle', SERVO_CENTER))
    return jsonify({"success": True, "angle": servo_angle})


# ══════════════════════════════════════════════════════════════════════════════
# STARTUP
# ══════════════════════════════════════════════════════════════════════════════
def _get_all_local_ips():
    """Get all local IP addresses of this machine."""
    import socket
    ips = ['127.0.0.1']
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None):
            ip = info[4][0]
            if ':' not in ip and ip not in ips:
                ips.append(ip)
    except: pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        if ip not in ips:
            ips.append(ip)
        s.close()
    except: pass
    return ips

def _generate_ssl_cert():
    """Generate self-signed SSL certificate covering all local IPs."""
    cert_file = 'cert.pem'
    key_file  = 'key.pem'

    # Always regenerate to include current IPs
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.backends import default_backend
        import datetime, ipaddress

        all_ips = _get_all_local_ips()
        print(f"[SSL] Generating certificate for IPs: {all_ips}")

        key = rsa.generate_private_key(
            public_exponent=65537, key_size=2048, backend=default_backend()
        )

        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, u'SARAS Robot'),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, u'SARAS'),
        ])

        # Build SAN with all IPs + localhost
        san_list = [x509.DNSName(u'localhost')]
        for ip in all_ips:
            try:
                san_list.append(x509.IPAddress(ipaddress.IPv4Address(ip)))
            except: pass

        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.utcnow())
            .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
            .add_extension(
                x509.SubjectAlternativeName(san_list), critical=False
            )
            .add_extension(
                x509.BasicConstraints(ca=True, path_length=None), critical=True
            )
            .sign(key, hashes.SHA256(), default_backend())
        )

        with open(cert_file, 'wb') as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        with open(key_file, 'wb') as f:
            f.write(key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption()
            ))
        print(f"[SSL] ✓ Certificate ready — covers {len(all_ips)} IPs")
        return cert_file, key_file

    except ImportError:
        print("[SSL] cryptography not found — run: pip install cryptography")
        return None, None
    except Exception as e:
        print(f"[SSL] Error: {e}")
        return None, None

if __name__ == '__main__':
    print("=" * 60)
    print("  🤖 Robot Control Server  —  Starting...")
    print("=" * 60)
    init_serial()
    init_tts()
    threading.Thread(target=uptime_ticker,    daemon=True).start()
    threading.Thread(target=obstacle_monitor, daemon=True).start()

    # Try HTTPS first (needed for mic access on network)
    cert, key = _generate_ssl_cert()
    if cert and key:
        import socket
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(('8.8.8.8', 80))
            local_ip = s.getsockname()[0]
            s.close()
        except:
            local_ip = '0.0.0.0'
        print(f"[SERVER] Running at https://localhost:5000")
        print(f"[SERVER] Network:  https://{local_ip}:5000")
        print("[SERVER] ⚠ Browser will show security warning — click 'Advanced' → 'Proceed'")
        print("[SERVER] Press Ctrl+C to stop.\n")
        socketio.run(app, host='0.0.0.0', port=5000, debug=False,
                     ssl_context=(cert, key))
    else:
        print("[SERVER] Running at http://0.0.0.0:5000 (HTTP — mic may not work on network)")
        print("[SERVER] Press Ctrl+C to stop.\n")
        socketio.run(app, host='0.0.0.0', port=5000, debug=False)
