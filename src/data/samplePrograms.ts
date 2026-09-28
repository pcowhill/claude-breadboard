// Sample block programs, stored as Blockly workspace-serialization JSON.

export interface SampleProgram {
  id: string;
  name: string;
  description: string;
  json: object;
}

const num = (n: number) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });

export const SAMPLE_PROGRAMS: SampleProgram[] = [
  {
    id: 'blink',
    name: 'Blink LED (D13)',
    description: 'The hello-world of Arduino: toggle pin 13 every half second.',
    json: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'event_start',
            x: 30,
            y: 30,
            next: {
              block: {
                type: 'control_forever',
                inputs: {
                  DO: {
                    block: {
                      type: 'io_set_digital',
                      fields: { PIN: '13', VALUE: 'HIGH' },
                      next: {
                        block: {
                          type: 'control_wait',
                          inputs: { MS: num(500) },
                          next: {
                            block: {
                              type: 'io_set_digital',
                              fields: { PIN: '13', VALUE: 'LOW' },
                              next: { block: { type: 'control_wait', inputs: { MS: num(500) } } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
  {
    id: 'button-led',
    name: 'Button controls LED',
    description: 'Read a push button on D2 and mirror it on the D13 LED.',
    json: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'event_start',
            x: 30,
            y: 30,
            next: {
              block: {
                type: 'control_forever',
                inputs: {
                  DO: {
                    block: {
                      type: 'controls_if',
                      extraState: { hasElse: true },
                      inputs: {
                        IF0: { block: { type: 'io_read_digital', fields: { PIN: '2' } } },
                        DO0: { block: { type: 'io_set_digital', fields: { PIN: '13', VALUE: 'HIGH' } } },
                        ELSE: { block: { type: 'io_set_digital', fields: { PIN: '13', VALUE: 'LOW' } } },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
  {
    id: 'pot-fade',
    name: 'Potentiometer fade',
    description: 'Read A0, map 0–1023 to 0–255 and drive PWM pin 9.',
    json: {
      variables: [{ name: 'level', id: 'varLevel' }],
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'event_start',
            x: 30,
            y: 30,
            next: {
              block: {
                type: 'control_forever',
                inputs: {
                  DO: {
                    block: {
                      type: 'variables_set',
                      fields: { VAR: { id: 'varLevel' } },
                      inputs: {
                        VALUE: {
                          block: {
                            type: 'math_map',
                            inputs: {
                              X: { block: { type: 'io_read_analog', fields: { PIN: '0' } } },
                              A: num(0),
                              B: num(1023),
                              C: num(0),
                              D: num(255),
                            },
                          },
                        },
                      },
                      next: {
                        block: {
                          type: 'io_set_pwm',
                          fields: { PIN: '9' },
                          inputs: { DUTY: { block: { type: 'variables_get', fields: { VAR: { id: 'varLevel' } } } } },
                          next: {
                            block: {
                              type: 'debug_print',
                              inputs: { VALUE: { block: { type: 'variables_get', fields: { VAR: { id: 'varLevel' } } } } },
                              next: { block: { type: 'control_wait', inputs: { MS: num(250) } } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
  {
    id: 'sevenseg-counter',
    name: '7-segment counter (74HC595)',
    description: 'Count 0–9 on a common-cathode display driven by a shift register.',
    json: {
      variables: [{ name: 'digit', id: 'varDigit' }],
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'event_start',
            x: 30,
            y: 30,
            next: {
              block: {
                type: 'variables_set',
                fields: { VAR: { id: 'varDigit' } },
                inputs: { VALUE: num(0) },
                next: {
                  block: {
                    type: 'control_forever',
                    inputs: {
                      DO: {
                        block: {
                          type: 'ic_display_digit',
                          fields: { DATA: '2', CLOCK: '3', LATCH: '4' },
                          inputs: { DIGIT: { block: { type: 'variables_get', fields: { VAR: { id: 'varDigit' } } } } },
                          next: {
                            block: {
                              type: 'debug_print',
                              inputs: { VALUE: { block: { type: 'variables_get', fields: { VAR: { id: 'varDigit' } } } } },
                              next: {
                                block: {
                                  type: 'control_wait',
                                  inputs: { MS: num(600) },
                                  next: {
                                    block: {
                                      type: 'math_change',
                                      fields: { VAR: { id: 'varDigit' } },
                                      inputs: { DELTA: num(1) },
                                      next: {
                                        block: {
                                          type: 'controls_if',
                                          inputs: {
                                            IF0: {
                                              block: {
                                                type: 'logic_compare',
                                                fields: { OP: 'GT' },
                                                inputs: {
                                                  A: { block: { type: 'variables_get', fields: { VAR: { id: 'varDigit' } } } },
                                                  B: num(9),
                                                },
                                              },
                                            },
                                            DO0: {
                                              block: {
                                                type: 'variables_set',
                                                fields: { VAR: { id: 'varDigit' } },
                                                inputs: { VALUE: num(0) },
                                              },
                                            },
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
];

export function sampleById(id: string): SampleProgram | undefined {
  return SAMPLE_PROGRAMS.find((s) => s.id === id);
}
