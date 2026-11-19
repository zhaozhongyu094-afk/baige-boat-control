#ifndef BOAT_MOTOR_H
#define BOAT_MOTOR_H
void Motor_Init(void);
unsigned char Motor_Command(unsigned char seq, unsigned char x, unsigned char y);
#endif
