/*
  WASD Robot — Fixed motor directions
  =====================================
  HC-SR04 : VCC→5V | GND→GND | TRIG→D2 | ECHO→D4
  Servo   : Red→5V | Brown→GND | Orange/Yellow→D12
  L298N   : IN1→D5 | IN2→D6 | IN3→D7 | IN4→D8
            ENA→D3 | ENB→D11
*/

#include <Servo.h>

const int TRIG_PIN = 2;
const int ECHO_PIN = 4;
const int SERVO_PIN = 12;

const int IN1 = 5;
const int IN2 = 6;
const int IN3 = 7;
const int IN4 = 8;
const int ENA = 3;
const int ENB = 11;

const int STOP_CM      = 25;
const int SERVO_CENTER = 90;
const int SERVO_STEP   = 10;
int       motorSpeed   = 180;

Servo cameraServo;
int   servoAngle    = SERVO_CENTER;
bool  obstacleFront = false;

unsigned long lastDistMs = 0;

// ── Motors ────────────────────────────────────────────────────────────────────
void motorStop() {
  analogWrite(ENA, 0);
  analogWrite(ENB, 0);
  digitalWrite(IN1, LOW); digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW); digitalWrite(IN4, LOW);
}

void motorForward() {
  analogWrite(ENA, motorSpeed);
  analogWrite(ENB, motorSpeed);
  // Swapped from previous version to fix reversed direction
  digitalWrite(IN1, LOW);  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW);  digitalWrite(IN4, HIGH);
}

void motorBackward() {
  analogWrite(ENA, motorSpeed);
  analogWrite(ENB, motorSpeed);
  // Swapped from previous version to fix reversed direction
  digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
}

void motorLeft() {
  analogWrite(ENA, motorSpeed);
  analogWrite(ENB, motorSpeed);
  digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);   // left wheel backward
  digitalWrite(IN3, LOW);  digitalWrite(IN4, HIGH);  // right wheel forward
}

void motorRight() {
  analogWrite(ENA, motorSpeed);
  analogWrite(ENB, motorSpeed);
  digitalWrite(IN1, LOW);  digitalWrite(IN2, HIGH);  // left wheel forward
  digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);   // right wheel backward
}

// ── Ultrasonic ────────────────────────────────────────────────────────────────
long getDistanceCM() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long dur = pulseIn(ECHO_PIN, HIGH, 30000);
  if (dur == 0) return 999;
  return dur / 58L;
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(9600);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT); pinMode(ENB, OUTPUT);
  motorStop();
  cameraServo.attach(SERVO_PIN);
  cameraServo.write(SERVO_CENTER);
  Serial.println("READY");
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // Distance check every 100 ms
  if (now - lastDistMs >= 100) {
    lastDistMs = now;
    long dist = getDistanceCM();
    Serial.print("DIST:"); Serial.println(dist);

    if (dist <= STOP_CM) {
      if (!obstacleFront) {
        obstacleFront = true;
        motorStop();
        Serial.println("STOP");
      }
    } else {
      if (obstacleFront) {
        obstacleFront = false;
        Serial.println("CLEAR");
      }
    }
  }

  // Serial commands
  if (Serial.available() > 0) {
    char cmd = (char)Serial.read();
    switch (cmd) {

      case 'W': case 'w':
        if (!obstacleFront) { motorForward();  Serial.println("OK:FORWARD"); }
        else                { motorStop();     Serial.println("BLOCKED"); }
        break;

      case 'S': case 's':
        motorBackward();
        Serial.println("OK:BACKWARD");
        break;

      case 'A': case 'a':
        motorLeft();
        Serial.println("OK:LEFT");
        break;

      case 'D': case 'd':
        motorRight();
        Serial.println("OK:RIGHT");
        break;

      case 'X': case 'x':
        motorStop();
        Serial.println("OK:STOP");
        break;

      case 'J': case 'j':
        servoAngle = constrain(servoAngle - SERVO_STEP, 0, 180);
        cameraServo.write(servoAngle);
        Serial.print("ANGLE:"); Serial.println(servoAngle);
        break;

      case 'L': case 'l':
        servoAngle = constrain(servoAngle + SERVO_STEP, 0, 180);
        cameraServo.write(servoAngle);
        Serial.print("ANGLE:"); Serial.println(servoAngle);
        break;

      case 'C': case 'c':
        servoAngle = SERVO_CENTER;
        cameraServo.write(SERVO_CENTER);
        Serial.println("OK:CENTER");
        break;

      case '+':
        motorSpeed = min(255, motorSpeed + 25);
        Serial.print("SPEED:"); Serial.println(motorSpeed);
        break;

      case '-':
        motorSpeed = max(50, motorSpeed - 25);
        Serial.print("SPEED:"); Serial.println(motorSpeed);
        break;

      case 'Q': case 'q':
        motorStop();
        Serial.println("OK:STOP");
        break;
    }
  }
}
