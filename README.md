# Real-Time Communication Platform

A standalone, production-ready Socket.IO server + TypeScript client SDK.

## Project Structure

```
socketsdk/
├── server/          # Node.js + Socket.IO server
├── sdk/             # Reusable TypeScript client SDK
└── test-app/        # Next.js test application
```

---

## 🚀 Quick Start

### Prerequisites
- Docker Desktop (running)
- Node.js ≥ 18

### 1. Start the Server + Redis

```powershell
cd server
docker compose up -d
```

This starts:
- **Socket.IO server** on `http://localhost:3002`
- **Redis** on `localhost:6379`

Check health:
```
http://localhost:3002/health
http://localhost:3002/metrics
```

### 2. Start the Test App

```powershell
cd test-app
npm run dev
```

Open `http://localhost:3000` (or 3001 if 3000 is taken).

---

## 🧪 Testing the SDK

The test app lets you simulate two users (Alice and Bob):

1. Open **two browser tabs** at `http://localhost:3000`
2. In **Tab 1**: Select **Alice**, click **Connect**
3. In **Tab 2**: Select **Bob**, click **Connect**
4. In both tabs: Click **"Open Chat with..."** to create a private room
5. Send messages — you'll see real-time delivery + typing indicators
6. Click **"Call Bob"** in Alice's tab to test audio call signaling

---

## ⚙️ Multi-Tenant Configuration

Edit `server/.env` to add your own projects:

```env
PROJECTS=[
  {"projectId":"myapp","apiKey":"my-api-key","jwtSecret":"my-jwt-secret"}
]
```

---

## 🔑 Generating JWT Tokens

Use any JWT library with the project's `jwtSecret`:

```typescript
import jwt from 'jsonwebtoken';

const token = jwt.sign(
  { userId: 'user-123', projectId: 'app1' },
  'super-secret-jwt-1',  // must match jwtSecret in PROJECTS env
  { expiresIn: '7d' }
);
```

**SDK connection:**
```typescript
import { CommunicationSDK } from '@realtimeplatform/sdk';

const sdk = new CommunicationSDK({
  serverUrl: 'http://localhost:3002',
  projectId: 'app1',
  apiKey: 'api-key-app1',
  token: token,  // signed JWT
});

await sdk.connect();
```

---

## 📦 SDK Usage

```typescript
// Chat
await sdk.chat.send({ roomId, content: 'Hello!' });
sdk.chat.onNew((msg) => console.log(msg));

// Typing
sdk.typing.start(roomId);
sdk.typing.onChange((p) => console.log(p.userId, 'is typing:', p.isTyping));

// Presence
await sdk.presence.subscribe(['user-a', 'user-b']);
sdk.presence.onOnline((s) => console.log(s.userId, 'online'));

// Private room
const { data: room } = await sdk.rooms.getPrivate('other-user-id');

// Calls
const { data: call } = await sdk.calls.start({ calleeId: 'bob', roomId: room.id });
sdk.calls.onRinging((call) => { /* show incoming call UI */ });
sdk.calls.onAccepted((call) => { /* start WebRTC */ });

// WebRTC (after call accepted)
await sdk.webrtc.initialize(call.id, {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  opus: { dtx: true, fec: true },
});
await sdk.webrtc.sendOffer(call.id, call.calleeId);
sdk.webrtc.onQualityChange((q) => console.log('RTT:', q.rtt, 'Loss:', q.packetLoss));

// Disconnect
sdk.disconnect();
```

---

## 🔧 Server Events Reference

| Event | Direction | Description |
|---|---|---|
| `chat:send` | client→server | Send a message |
| `chat:new` | server→client | New message in room |
| `chat:edit` | client→server | Edit own message |
| `chat:edited` | server→client | Message was edited |
| `chat:delete` | client→server | Delete own message |
| `chat:deleted` | server→client | Message was deleted |
| `chat:delivered` | bidirectional | Mark/notify delivered |
| `chat:read` | bidirectional | Mark/notify read |
| `typing:start` | client→server | Start typing |
| `typing:stop` | client→server | Stop typing |
| `typing:change` | server→client | Typing state change |
| `presence:subscribe` | client→server | Subscribe to user presence |
| `presence:online` | server→client | User came online |
| `presence:offline` | server→client | User went offline |
| `room:create` | client→server | Create a room |
| `room:join` | client→server | Join a room |
| `room:leave` | client→server | Leave a room |
| `room:private:get` | client→server | Get/create private room |
| `notification:new` | server→client | Incoming notification |
| `call:start` | client→server | Start audio call |
| `call:ring` | server→client | Incoming call |
| `call:accept` | bidirectional | Accept call |
| `call:reject` | bidirectional | Reject call |
| `call:end` | bidirectional | End call |
| `call:missed` | server→client | Call was missed |
| `call:busy` | server→client | Callee is busy |
| `webrtc:offer` | client→server | SDP offer (relayed) |
| `webrtc:answer` | client→server | SDP answer (relayed) |
| `webrtc:ice` | client→server | ICE candidate (relayed) |

---

## 📊 Monitoring

- `GET /health` — Server health, Redis status, memory usage
- `GET /metrics` — Prometheus-compatible metrics

---

## 🏗️ Production Deployment (Oracle Cloud Free VM)

```bash
# On the VM
git clone <your-repo>
cd server

# Edit .env with production values
nano .env

# Start
docker compose up -d

# Check logs
docker compose logs -f server
```

For horizontal scaling, multiple server instances can run behind nginx — the Socket.IO Redis adapter handles cross-instance messaging automatically.
