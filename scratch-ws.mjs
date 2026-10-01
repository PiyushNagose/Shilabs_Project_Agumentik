import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:4000/realtime?token=dummy');

ws.on('open', () => {
  console.log('Connected!');
  ws.close();
});

ws.on('error', (err) => {
  console.error('WebSocket Error:', err);
});

ws.on('unexpected-response', (request, response) => {
  console.error('Unexpected response:', response.statusCode, response.statusMessage);
});
