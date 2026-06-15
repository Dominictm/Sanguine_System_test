#!/usr/bin/env node
'use strict';
// Wrapper / process guardian for server.js.
// Runs server.js as a child. When the child exits with code 75 (RESTART_CODE),
// the wrapper immediately relaunches it — the wrapper process itself never stops,
// so the terminal window stays open and no new browser tab is ever opened.
// Any other exit code is treated as a real stop and the wrapper exits too.

const { spawn } = require('child_process');
const path      = require('path');

const RESTART_CODE = 75;
const SERVER       = path.join(__dirname, 'server.js');

let _child = null;

function start() {
  _child = spawn(process.execPath, [SERVER], {
    stdio: 'inherit',
    // VTM_SUPERVISED tells server.js a guardian is watching for exit code 75,
    // so it may safely self-exit to restart. Without it the server won't kill itself.
    env:   { ...process.env, VTM_SUPERVISED: '1' },
    cwd:   __dirname,
  });

  _child.on('exit', (code, signal) => {
    if (code === RESTART_CODE) {
      console.log('\n  [wrapper] Перезапуск сервера...\n');
      setTimeout(start, 150);
    } else {
      console.log(`\n  [wrapper] Сервер остановлен (code: ${code ?? signal}).\n`);
      process.exit(code ?? 1);
    }
  });

  _child.on('error', err => {
    console.error('[wrapper] Ошибка запуска сервера:', err.message);
    process.exit(1);
  });
}

// Propagate Ctrl-C to child
process.on('SIGINT',  () => { _child?.kill('SIGINT');  });
process.on('SIGTERM', () => { _child?.kill('SIGTERM'); });

start();
