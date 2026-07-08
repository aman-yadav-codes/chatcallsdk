# Reusable Real-Time Communication Platform (SDK & Deployment Guide)

This documentation explains how to initialize and use the client SDK in any application (Next.js, React, React Native, etc.), details all features, and outlines hosting the server on an Oracle Cloud Always Free VM using PM2.

---

## 🌟 SDK Core Features

* **WebSocket-First Transport**: Always connects via native WebSockets first, bypassing slow HTTP polling fallback.
* **Multi-Tenant Isolation**: Rooms, users, events, and Redis caches are completely isolated by `projectId`.
* **Reliable Messaging**: Integrated retry mechanisms for critical actions (message send, edit, delete, calls).
* **Presence & Debounced Typing**: Batched presence updates and leading-edge typing indicators minimize CPU/network usage.
* **Audio Call Signaling State Machine**: Handles ringing, accept, reject, busy, missed, and end call flows.
* **Quality & Latency Monitoring**: Automatically tracks round-trip time (RTT), packet loss, jitter, and available bandwidth.
* **Adaptive Bitrate control**: Dynamically scales audio quality (6kbps to 40kbps) on weak or unstable networks using Opus parameters.

---

## 📦 Installation

To use the client SDK, copy the `sdk` folder into your project directory or distribute it as a package. Install its single dependency (`socket.io-client`):

```bash
# inside your project
npm install path/to/sdk
```

---

## 🛠️ SDK Setup & Initialization

Create an instance of `CommunicationSDK` and connect it when your app starts:

```typescript
import { CommunicationSDK } from '@realtimeplatform/sdk';

const sdk = new CommunicationSDK({
  serverUrl: 'http://your-server-ip:3002', // Or domain name
  projectId: 'app1',
  apiKey: 'api-key-app1',
  token: 'user-jwt-token',                 // Token containing { userId, projectId }
  reconnection: true,                     // Auto reconnect on connection drops
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
});

// Await connection before invoking module APIs
await sdk.connect();
```

---

## 🔌 Module APIs

### 1. Chat Module (`sdk.chat`)

#### Sending a Message
```typescript
const res = await sdk.chat.send({
  roomId: 'room-123',
  content: 'Hello, World!',
  tempId: 'optimistic-ui-id', // Optional client-generated temp ID
});
if (res.success) {
  console.log('Sent:', res.data);
}
```

#### Editing & Deleting
```typescript
await sdk.chat.edit({ messageId: 'msg-abc', roomId: 'room-123', content: 'New text' });
await sdk.chat.delete({ messageId: 'msg-abc', roomId: 'room-123' });
```

#### Read & Delivery Receipts
```typescript
// Call this when message appears in viewport or is loaded
sdk.chat.markDelivered(message.id, roomId);
sdk.chat.markRead(message.id, roomId);

// Subscriptions
sdk.chat.onNew(msg => console.log('New message:', msg));
sdk.chat.onDelivered(p => console.log(`Delivered msg ${p.messageId} to ${p.userId}`));
sdk.chat.onRead(p => console.log(`Read msg ${p.messageId} by ${p.userId}`));
```

---

### 2. Presence Module (`sdk.presence`)

Track user online status and last-seen timestamps:

```typescript
// Subscribe to a list of users
const initialStatus = await sdk.presence.subscribe(['user-alice', 'user-bob']);

// Hooks
sdk.presence.onOnline(status => console.log(`${status.userId} is online`));
sdk.presence.onOffline(status => console.log(`${status.userId} is offline`));
sdk.presence.onLastSeen(status => console.log(`${status.userId} last seen: ${status.lastSeen}`));
```

---

### 3. Typing Module (`sdk.typing`)

Enables debounced typing notifications (leading-edge emit):

```typescript
// Trigger on input change (internally debounced)
sdk.typing.start(roomId);

// Trigger on form submit or blur
sdk.typing.stop(roomId);

// Listen to other users typing changes
sdk.typing.onChange(payload => {
  console.log(`${payload.userId} is typing: ${payload.isTyping}`);
});
```

---

### 4. Room Module (`sdk.rooms`)

Manage chat rooms (private 1v1 and group rooms):

```typescript
// Open/Get a deterministic private room with another user
const res = await sdk.rooms.getPrivate('target-user-id');
const roomId = res.data.id;

// Create a group room
await sdk.rooms.create({ name: 'Developers', type: 'group', members: ['user1', 'user2'] });

// Leave a room
await sdk.rooms.leave(roomId);

// Listeners
sdk.rooms.onCreated(room => console.log('New room created:', room));
sdk.rooms.onJoined(p => console.log(`${p.userId} joined room ${p.roomId}`));
```

---

### 5. Audio Calls & WebRTC Module (`sdk.calls` & `sdk.webrtc`)

Coordinates call states via Socket.IO signaling, and establishes peer-to-peer audio channels via WebRTC.

#### Placing a Call
```typescript
const res = await sdk.calls.start({ calleeId: 'bob', roomId: 'private-room-id' });
const callId = res.data.id;

// Listen to accept / reject / busy / end states
sdk.calls.onAccepted(async (call) => {
  // 1. Initialize WebRTC
  const pc = await sdk.webrtc.initialize(call.id, {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    opus: { dtx: true, fec: true } // Opus optimization
  });

  // 2. Send SDP Offer
  await sdk.webrtc.sendOffer(call.id, call.calleeId);
});

sdk.calls.onRejected(() => console.log('Call rejected'));
```

#### Receiving a Call
```typescript
sdk.calls.onRinging(async (call) => {
  // Show Incoming Call Ringing UI screen
  // Accept call:
  await sdk.calls.accept(call.id);
});

// Setup signaling handlers on caller/callee setup:
sdk.webrtc.onOffer(async (p) => {
  await sdk.webrtc.handleOffer(p.callId, p.fromUserId, p.sdp);
});

sdk.webrtc.onAnswer(async (p) => {
  await sdk.webrtc.handleAnswer(p.callId, p.sdp);
});

sdk.webrtc.onIceCandidate(async (p) => {
  await sdk.webrtc.addIceCandidate(p.callId, p.candidate);
});
```

---

### 6. Real-Time Notifications (`sdk.notifications`)

Exposes push/offline notifications triggered by other parts of the platform:

```typescript
sdk.notifications.onNew(notif => {
  console.log(`Notification [${notif.type}]: ${notif.title} - ${notif.body}`);
});
```

---

## 📊 Connection Quality & Metrics

The SDK continuously monitors local connection health and emits connection quality reports:

```typescript
// Active monitoring stats (updated every 2 seconds)
sdk.webrtc.onQualityChange((stats) => {
  console.log(`RTT: ${stats.rtt}ms`);
  console.log(`Packet Loss: ${stats.packetLoss}%`);
  console.log(`Jitter: ${stats.jitter}ms`);
  console.log(`Bitrate: ${stats.bitrate}kbps`);
  console.log(`Overall Health Score: ${stats.quality}`); // 'excellent' | 'good' | 'fair' | 'poor'
});
```

---

## ☁️ Oracle Cloud Hosting (PM2 & Redis Setup)

To host this platform on an Oracle Cloud Always Free VM:

### 1. Prerequisite Installations

Connect to your Ubuntu instance and run:

```bash
# Update Ubuntu packages
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install pm2 -g

# Install Redis Server
sudo apt-get install -y redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

### 2. Deployment Steps

Pack and upload your server directory from your local development machine:

```bash
# Local machine
tar -czf server.tar.gz -C server src package.json tsconfig.json .env
scp -i path/to/your-ssh-key.key server.tar.gz ubuntu@your-vm-ip:/home/ubuntu/
```

Extract, install dependencies, compile, and run on the remote VM:

```bash
# Remote VM
mkdir -p socketsdk-server
tar -xzf server.tar.gz -C socketsdk-server
cd socketsdk-server

# Install dependencies and build
npm install
npm run build

# Start with PM2
pm2 start dist/app.js --name socketsdk-server

# Configure PM2 to start on system boot
pm2 startup
pm2 save
```

### 3. Open Firewall Ports in Oracle Cloud

Oracle Cloud instances block all inbound traffic by default except port 22. You must open port `3002` (the server's socket port):

#### Option A: Allow via local iptables
Ubuntu noble/jammy uses iptables or ufw. Run the following on the VM:
```bash
sudo ufw allow 3002/tcp
```
Or if using Oracle Default iptables:
```bash
sudo iptables -I INPUT 6 -p tcp --dport 3002 -j ACCEPT
sudo netfilter-persistent save
```

#### Option B: Configure Oracle Cloud Ingress Rule
1. Open the Oracle Cloud console.
2. Navigate to **Networking → Virtual Cloud Networks → Security Lists**.
3. Select your security list and click **Add Ingress Rules**.
4. Add the following rule:
   - **Source Type**: CIDR
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: TCP
   - **Source Port Range**: All
   - **Destination Port Range**: `3002`
   - **Description**: Socketsdk Server

---

## 🔒 Security Best Practices

1. **Production JWT Verification**: Ensure you replace `super-secret-jwt-1` in your `.env` file with a strong random key.
2. **Reverse Proxy (Nginx + SSL)**: Configure Nginx as a reverse proxy in front of port 3002 to encrypt all WebSockets connections via HTTPS (`wss://`).
