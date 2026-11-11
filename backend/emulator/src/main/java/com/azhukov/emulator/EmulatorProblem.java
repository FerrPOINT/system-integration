package com.azhukov.emulator;

final class EmulatorProblem extends RuntimeException {
    final int status;
    final String code;

    EmulatorProblem(int status, String code) {
        super(code);
        this.status = status;
        this.code = code;
    }
}
