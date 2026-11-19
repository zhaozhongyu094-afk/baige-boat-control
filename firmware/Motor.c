#include <REGX52.H>
#include "Motor.h"

#define STEPS 32
#define HOLD_PERIODS 39
#define IDLE_PORT 0xF0   /* Upper pins released; both bridges brake with 00. */

static volatile unsigned char leftDuty, rightDuty, leftPins, rightPins, lease;
static unsigned char lastSeq, phase;

void Motor_Init(void)
{
    P2 = IDLE_PORT;
    TMOD = (TMOD & 0xF0) | 0x02;  /* T0, 8-bit hardware auto-reload */
    TH0 = TL0 = 26;               /* 230 counts at 11.0592 MHz / 12 */
    TF0 = 0;
    PT0 = 1;
    ET0 = 1;
    TR0 = 1;
}

static unsigned char magnitude(int value, int scale)
{
    if (value < 0) value = -value;
    return (unsigned char)((value * STEPS + scale / 2) / scale);
}

unsigned char Motor_Command(unsigned char seq, unsigned char rawX, unsigned char rawY)
{
    int x = (int)rawX - 100;
    int y = (int)rawY - 100;
    int left = y + x, right = y - x;
    int scale = 100, peak;
    unsigned char dl, dr, delta, neutral;
    neutral = (x == 0 && y == 0);
    peak = left < 0 ? -left : left;
    if (peak > scale) scale = peak;
    peak = right < 0 ? -right : right;
    if (peak > scale) scale = peak;
    dl = magnitude(left, scale);
    dr = magnitude(right, scale);
    delta = (seq - lastSeq) & 127;
    /* Timer owns expiry. Check and publish the two motors as one command. */
    ET0 = 0;
    if (!neutral && (!lease || !delta || delta >= 64)) {
        unsigned char armed = lease != 0;
        ET0 = 1;
        return armed ? 2 : 0;   /* 2: stale sequence, do not ACK */
    }
    lastSeq = seq;
    leftPins = left >= 0 ? 0x08 : 0x04;
    rightPins = right >= 0 ? 0x01 : 0x02;
    leftDuty = dl;
    rightDuty = dr;
    if (neutral) P2 = IDLE_PORT;
    lease = HOLD_PERIODS;
    ET0 = 1;
    return 1;
}

void Timer0_ISR(void) interrupt 1 using 1
{
    unsigned char pins = IDLE_PORT;
    if (++phase == STEPS) {
        phase = 0;
        if (lease) --lease;
    }
    if (lease) {
        if (phase < leftDuty) pins |= leftPins;
        if (phase < rightDuty) pins |= rightPins;
    }
    P2 = pins;
}
