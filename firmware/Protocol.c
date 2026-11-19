#include <REGX52.H>
#include "Protocol.h"
#include "Motor.h"

#define RX_MASK 15
static volatile unsigned char rx[16], head, tail, overrun;
static volatile unsigned char tx[6], txIndex, txBusy;
static unsigned char frame[6], used = 6;

static unsigned char crc8(unsigned char *bytes, unsigned char count)
{
    unsigned char crc = 0, i;
    while (count--) {
        crc ^= *bytes++;
        for (i = 0; i < 8; ++i)
            crc = (crc & 0x80) ? (crc << 1) ^ 7 : crc << 1;
    }
    return crc;
}

void Radio_Init(void)
{
    SCON = 0x50;
    PCON |= 0x80;
    TMOD = (TMOD & 0x0F) | 0x20;
    TH1 = TL1 = 0xFA;             /* 9600 8N1, 11.0592 MHz, 12T */
    TR1 = 1;
    ES = 1;
}

void Serial_ISR(void) interrupt 4 using 2
{
    unsigned char next, value;
    if (RI) {
        value = SBUF;
        RI = 0;
        next = (head + 1) & RX_MASK;
        if (next == tail) overrun = 1;
        else { rx[head] = value; head = next; }
    }
    if (TI) {
        TI = 0;
        if (txIndex < 6) SBUF = tx[txIndex++];
        else txBusy = 0;
    }
}

static void reply(unsigned char seq, unsigned char armed)
{
    unsigned char body[3], check;
    if (txBusy) return;
    body[0] = 1; body[1] = seq; body[2] = armed;
    check = crc8(body, 3);
    ES = 0;
    if (TI) TI = 0;
    tx[1] = 1; tx[2] = seq; tx[3] = armed;
    tx[4] = check >> 4; tx[5] = check & 15;
    txBusy = 1; txIndex = 1;
    SBUF = 0xFE;
    ES = 1;
}

static void receive(unsigned char value)
{
    unsigned char check, status;
    if (value == 0xFF) { used = 0; return; }
    if (used >= 6) return;
    frame[used++] = value;
    if (used != 6 || frame[0] != 1 || frame[1] > 127 ||
        frame[2] > 200 || frame[3] > 200) return;
    check = crc8(frame, 4);
    if (frame[4] != (check >> 4) || frame[5] != (check & 15)) return;
    status = Motor_Command(frame[1], frame[2], frame[3]);
    if (status < 2) reply(frame[1], status);
}

void Radio_Poll(void)
{
    unsigned char value;
    if (overrun) {
        ES = 0;
        tail = head; used = 6; overrun = 0;
        ES = 1;
    }
    if (tail == head) return;
    value = rx[tail];
    tail = (tail + 1) & RX_MASK;
    receive(value);
}
