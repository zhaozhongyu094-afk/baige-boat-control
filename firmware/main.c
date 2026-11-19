#include <REGX52.H>
#include "Motor.h"
#include "Protocol.h"

void main(void)
{
    Motor_Init();
    Radio_Init();
    EA = 1;
    for (;;) Radio_Poll();
}
