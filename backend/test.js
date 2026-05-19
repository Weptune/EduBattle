const { io } = require('socket.io-client');
const socket = io('http://localhost:3001');

socket.on('connect', () => {
  console.log('Connected');
  socket.emit('join_bot_queue', { name: 'Test' });
});

socket.on('match_found', (data) => {
  console.log('Match found! Draft turn:', data.match.draftTurn, 'My ID:', socket.id);
  if (data.match.draftTurn === socket.id) {
    console.log('My turn to draft. Waiting 20 seconds to see if auto-draft works...');
    setTimeout(() => {
        console.log('20 seconds passed. Did we get draft_complete or round_start?');
    }, 20000);
  }
});

socket.on('draft_complete', (data) => console.log('Draft complete:', data));
socket.on('round_start', (data) => console.log('Round started!', data));
socket.on('disconnect', () => console.log('Disconnected'));
