const io = require('socket.io-client');
const token = process.env.JWT_TOKEN;
const stake = process.env.STAKE_LEVEL || 'low';
const socket = io('http://localhost:3001', { auth: { token } });
socket.on('connect', () => {
  console.log('已连到服务器，发送准备好了');
  socket.emit('game:ready', { stakeLevel: stake });
  // 保持连接，等待服务器发送 game:next 事件
});

// 处理服务器发来的 game:next，表示可以开始下一步操作
socket.on('game:next', (data) => {
  console.log('收到 game:next 事件', data);
  // 这里可以根据需要发送行动指令，例如自动 call
  if (data && data.action === 'call') {
    console.log('自动执行 call');
    socket.emit('game:action', { type: 'call' });
  }
});

socket.on('disconnect', () => {
  console.log('已断开与服务器的连接');
});
socket.on('connect_error', (err) => {
  console.error('连接错误', err);
});
