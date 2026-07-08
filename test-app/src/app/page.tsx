'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { CommunicationSDK, Message, Call, PresenceStatus, TypingPayload, Notification } from '../sdk';

// ─── Config — Points to the DuckDNS HTTPS URL for the live server ─────────────
const SERVER_URL = 'https://socketrocket.duckdns.org';
const PROJECT_ID = 'app1';
const API_KEY = 'api-key-app1';

// Pre-signed JWT tokens (valid 30 days) — generated via server/generate-tokens.ts
// These match jwtSecret = 'super-secret-jwt-1' from server/.env
const TOKENS: Record<string, string> = {
  alice: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhbGljZSIsInByb2plY3RJZCI6ImFwcDEiLCJpYXQiOjE3ODM0OTM5MjIsImV4cCI6MTc4NjA4NTkyMn0.zEuXUQLVDIDvr0bFuX3TcDGpM87_GJYvyPBlUk-RMps',
  bob:   'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJib2IiLCJwcm9qZWN0SWQiOiJhcHAxIiwiaWF0IjoxNzgzNDkzOTIyLCJleHAiOjE3ODYwODU5MjJ9.eVajl6X6bqCUGIp_LFn0e7SGuA2HYUiKL0WI920Hzsk',
};

const USERS = {
  alice: { userId: 'alice', name: 'Alice 🟢' },
  bob: { userId: 'bob', name: 'Bob 🔵' },
};

type LogLevel = 'info' | 'success' | 'error' | 'warn';
interface LogEntry { ts: string; level: LogLevel; msg: string; }

export default function TestPage() {
  // ── State ────────────────────────────────────────────────────────────────
  const [selectedUser, setSelectedUser] = useState<'alice' | 'bob'>('alice');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [roomId, setRoomId] = useState('');
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [callState, setCallState] = useState<string>('idle');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [latency, setLatency] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const sdkRef = useRef<CommunicationSDK | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // ── Logger ───────────────────────────────────────────────────────────────
  const log = useCallback((msg: string, level: LogLevel = 'info') => {
    setLogs(prev => [...prev.slice(-99), {
      ts: new Date().toLocaleTimeString(),
      level,
      msg,
    }]);
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages, typingUsers]);

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // ── Connect ───────────────────────────────────────────────────────────────
  const connect = async () => {
    if (sdkRef.current?.isConnected) return;
    setConnecting(true);
    log(`Connecting as ${USERS[selectedUser].name}...`);

    const sdk = new CommunicationSDK({
      serverUrl: SERVER_URL,
      projectId: PROJECT_ID,
      apiKey: API_KEY,
      token: TOKENS[selectedUser],
    });

    try {
      // Test server health check first
      log('Checking server health check endpoint...');
      const health = await sdk.checkServerHealth();
      if (!health) {
        log('Server health check failed! Server might be offline or unreachable.', 'error');
        setConnecting(false);
        return;
      }
      log('Server is healthy! Initiating WebSocket connection...');

      await sdk.connect();
      sdkRef.current = sdk;
      setConnected(true);
      log(`Connected as ${USERS[selectedUser].name} successfully!`, 'success');

      // ── Chat events ─────────────────────────────────────────────────────
      sdk.chat.onNew((msg) => {
        setMessages(prev => [...prev, msg]);
        log(`New message from ${msg.senderId}: ${msg.content}`);
        sdk.chat.markDelivered(msg.id, msg.roomId);
      });

      sdk.chat.onDelivered((p) => log(`✓ Delivered: ${p.messageId}`));
      sdk.chat.onRead((p) => log(`✓✓ Read: ${p.messageId}`));

      // ── Typing events ────────────────────────────────────────────────────
      sdk.typing.onChange((p: TypingPayload) => {
        if (p.userId === USERS[selectedUser].userId) return;
        setTypingUsers(prev =>
          p.isTyping ? [...new Set([...prev, p.userId])] : prev.filter(u => u !== p.userId)
        );
      });

      // ── Presence events ──────────────────────────────────────────────────
      sdk.presence.onOnline((s: PresenceStatus) => {
        setOnlineUsers(prev => new Set([...prev, s.userId]));
        log(`${s.userId} came online`, 'success');
      });
      sdk.presence.onOffline((s: PresenceStatus) => {
        setOnlineUsers(prev => { const n = new Set(prev); n.delete(s.userId); return n; });
        log(`${s.userId} went offline`, 'warn');
      });

      // Subscribe to initial status of the other user
      const targetUser = selectedUser === 'alice' ? 'bob' : 'alice';
      const initialPresence = await sdk.presence.subscribe([targetUser]);
      const targetOnline = initialPresence.find(p => p.userId === targetUser)?.online;
      if (targetOnline) {
        setOnlineUsers(prev => new Set([...prev, targetUser]));
      }

      // ── Notification events ──────────────────────────────────────────────
      sdk.notifications.onNew((n) => {
        setNotifications(prev => [n, ...prev]);
        log(`🔔 Notification: ${n.title} — ${n.body}`, 'info');
      });

      // ── Call events ──────────────────────────────────────────────────────
      sdk.calls.onRinging((call) => {
        setActiveCall(call);
        setCallState('ringing');
        log(`📞 Incoming call from ${call.callerId}`, 'warn');
      });

      sdk.calls.onAccepted(async (call) => {
        setActiveCall(call);
        setCallState('accepted');
        log(`✅ Call accepted! Establishing audio stream...`, 'success');

        // Setup WebRTC Audio connection on acceptance
        try {
          await sdk.webrtc.initialize(call.id);
          log('WebRTC peer connection initialized.');
          if (call.callerId === USERS[selectedUser].userId) {
            log('Sending offer to callee...');
            await sdk.webrtc.sendOffer(call.id, call.calleeId);
          }
        } catch (err) {
          log(`WebRTC initialization failed: ${(err as Error).message}`, 'error');
        }
      });

      sdk.calls.onRejected((p) => {
        setActiveCall(null);
        setCallState('idle');
        log(`❌ Call rejected by ${p.rejectedBy}`, 'error');
      });

      sdk.calls.onEnded((p) => {
        setActiveCall(null);
        setCallState('idle');
        sdk.webrtc.cleanup(p.callId);
        log(`📵 Call ended by ${p.endedBy}`, 'warn');
      });

      sdk.calls.onMissed((p) => {
        setActiveCall(null);
        setCallState('idle');
        log(`📵 Missed call`, 'warn');
      });

      sdk.calls.onBusy(() => {
        setCallState('idle');
        log('User is busy', 'warn');
      });

      // ── WebRTC Signaling handlers ────────────────────────────────────────
      sdk.webrtc.onOffer(async (p) => {
        log('Received WebRTC SDP offer, answering...');
        await sdk.webrtc.handleOffer(p.callId, p.fromUserId, p.sdp);
      });

      sdk.webrtc.onAnswer(async (p) => {
        log('Received WebRTC SDP answer, establishing connection...');
        await sdk.webrtc.handleAnswer(p.callId, p.sdp);
      });

      sdk.webrtc.onIceCandidate(async (p) => {
        await sdk.webrtc.addIceCandidate(p.callId, p.candidate);
      });

      sdk.webrtc.onQualityChange((q) => {
        log(`Quality: RTT ${Math.round(q.rtt)}ms, Loss ${q.packetLoss}%, Jitter ${Math.round(q.jitter)}ms`, 'info');
      });

      // ── Latency polling ──────────────────────────────────────────────────
      const latencyInterval = setInterval(() => {
        setLatency(sdk.metrics.socketLatency);
      }, 5000);

      return () => clearInterval(latencyInterval);
    } catch (err) {
      log(`Connection failed: ${(err as Error).message}`, 'error');
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    sdkRef.current?.disconnect();
    sdkRef.current = null;
    setConnected(false);
    setMessages([]);
    setRoomId('');
    setActiveCall(null);
    setCallState('idle');
    setNotifications([]);
    log('Disconnected from server');
  };

  // ── Room ──────────────────────────────────────────────────────────────────
  const joinPrivateRoom = async () => {
    const sdk = sdkRef.current;
    if (!sdk) return;
    const targetUser = selectedUser === 'alice' ? 'bob' : 'alice';
    const res = await sdk.rooms.getPrivate(targetUser);
    if (res.success && res.data) {
      setRoomId(res.data.id);
      log(`Joined private room with ${targetUser}: ${res.data.id}`, 'success');
    } else {
      log(`Failed to get room: ${res.error?.message}`, 'error');
    }
  };

  // ── Chat ──────────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const sdk = sdkRef.current;
    if (!sdk || !roomId || !input.trim()) return;
    const content = input.trim();
    setInput('');
    sdk.typing.stop(roomId);

    const res = await sdk.chat.send({ roomId, content, tempId: `temp-${Date.now()}` });
    if (res.success) {
      log(`Sent: ${content}`, 'success');
    } else {
      log(`Send failed: ${res.error?.message}`, 'error');
    }
  };

  const handleInputChange = (val: string) => {
    setInput(val);
    const sdk = sdkRef.current;
    if (!sdk || !roomId) return;

    sdk.typing.start(roomId);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => sdk.typing.stop(roomId), 3000);
  };

  // ── Calls ─────────────────────────────────────────────────────────────────
  const startCall = async () => {
    const sdk = sdkRef.current;
    if (!sdk || !roomId) return;
    const calleeId = selectedUser === 'alice' ? 'bob' : 'alice';
    const res = await sdk.calls.start({ calleeId, roomId });
    if (res.success && res.data) {
      setActiveCall(res.data);
      setCallState('ringing');
      log(`📞 Calling ${calleeId}...`, 'info');
    } else {
      log(`Call failed: ${res.error?.message}`, 'error');
    }
  };

  const acceptCall = async () => {
    if (!sdkRef.current || !activeCall) return;
    await sdkRef.current.calls.accept(activeCall.id);
    setCallState('accepted');
  };

  const rejectCall = async () => {
    if (!sdkRef.current || !activeCall) return;
    await sdkRef.current.calls.reject(activeCall.id);
    setActiveCall(null);
    setCallState('idle');
  };

  const endCall = async () => {
    if (!sdkRef.current || !activeCall) return;
    await sdkRef.current.calls.end(activeCall.id);
    setActiveCall(null);
    setCallState('idle');
  };

  const levelColors: Record<LogLevel, string> = {
    info: 'text-blue-400',
    success: 'text-green-400',
    error: 'text-red-400',
    warn: 'text-yellow-400',
  };

  return (
    <div className="h-screen bg-gray-950 text-gray-100 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white">🧪 RTC SDK Production Test Console</h1>
          <p className="text-xs text-gray-400">Live VM: socketrocket.duckdns.org (Multi-Tenant)</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
          <span className="text-sm text-gray-300">{connected ? `Connected as ${USERS[selectedUser].name}` : 'Disconnected'}</span>
          {connected && latency > 0 && (
            <span className="text-xs bg-gray-800 px-2 py-1 rounded text-gray-400">{latency}ms latency</span>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — controls */}
        <div className="w-72 bg-gray-900 border-r border-gray-800 flex flex-col gap-4 p-4 overflow-y-auto">
          {/* User Select */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block font-semibold">1. Select User Identity</label>
            <div className="flex gap-2">
              {(['alice', 'bob'] as const).map(u => (
                <button
                  key={u}
                  disabled={connected}
                  onClick={() => setSelectedUser(u)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    selectedUser === u
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  } disabled:opacity-50`}
                >
                  {USERS[u].name}
                </button>
              ))}
            </div>
          </div>

          {/* Connect / Disconnect */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block font-semibold">2. Server Connection</label>
            <button
              onClick={connected ? disconnect : connect}
              disabled={connecting}
              className={`w-full py-2.5 rounded-lg font-semibold text-sm transition-all ${
                connected
                  ? 'bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-900/50'
                  : 'bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-900/50'
              } disabled:opacity-50`}
            >
              {connecting ? 'Checking Health...' : connected ? 'Disconnect' : 'Connect to Live Server'}
            </button>
          </div>

          {/* Room */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block font-semibold">3. Initialize Chat Room</label>
            <button
              onClick={joinPrivateRoom}
              disabled={!connected}
              className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50 transition-all"
            >
              Open 1v1 Room with {selectedUser === 'alice' ? 'Bob' : 'Alice'}
            </button>
            {roomId && (
              <p className="text-xs text-gray-500 mt-2 break-all font-mono">ID: {roomId.split('::').pop()}</p>
            )}
          </div>

          {/* Presence */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block font-semibold">Presence Indicators</label>
            <div className="space-y-1">
              {['alice', 'bob'].map(u => (
                <div key={u} className="flex items-center gap-2 text-sm bg-gray-950 p-2 rounded-lg border border-gray-800">
                  <span className={`w-2.5 h-2.5 rounded-full ${onlineUsers.has(u) ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
                  <span className="text-gray-300 capitalize">{u}</span>
                  {u === USERS[selectedUser].userId && <span className="text-xs text-gray-500 ml-auto">(you)</span>}
                  {u !== USERS[selectedUser].userId && (
                    <span className="text-xs text-gray-400 ml-auto font-mono">
                      {onlineUsers.has(u) ? 'online' : 'offline'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Call Controls */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block font-semibold">Audio Call (WebRTC)</label>
            <div className="flex flex-col gap-2">
              {callState === 'idle' && (
                <button
                  onClick={startCall}
                  disabled={!connected || !roomId}
                  className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  📞 Start Call with {selectedUser === 'alice' ? 'Bob' : 'Alice'}
                </button>
              )}
              {callState === 'ringing' && activeCall?.calleeId === USERS[selectedUser].userId && (
                <div className="space-y-2 bg-gray-950 p-3 rounded-lg border border-yellow-600/30 animate-pulse">
                  <p className="text-sm text-yellow-400 font-medium">📞 Incoming call...</p>
                  <div className="flex gap-2">
                    <button onClick={acceptCall} className="flex-1 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm">Accept</button>
                    <button onClick={rejectCall} className="flex-1 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm">Reject</button>
                  </div>
                </div>
              )}
              {callState === 'ringing' && activeCall?.callerId === USERS[selectedUser].userId && (
                <div className="space-y-2 bg-gray-950 p-3 rounded-lg border border-yellow-600/30">
                  <p className="text-sm text-yellow-400 animate-pulse">📱 Calling...</p>
                  <button onClick={endCall} className="w-full py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm">Cancel</button>
                </div>
              )}
              {callState === 'accepted' && (
                <div className="space-y-2 bg-gray-950 p-3 rounded-lg border border-green-600/30">
                  <p className="text-sm text-green-400 font-medium">✅ Call Active (Opus Audio)</p>
                  <button onClick={endCall} className="w-full py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm">End Call</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center — Chat */}
        <div className="flex-1 flex flex-col bg-gray-950/40">
          {/* Messages list */}
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 ? (
              <div className="text-center text-gray-600 mt-20">
                <p className="text-4xl mb-3">💬</p>
                <p className="font-semibold text-sm">No messages yet.</p>
                <p className="text-xs text-gray-500 mt-1">Connect to the live server and open a room to start testing.</p>
              </div>
            ) : (
              messages.map((msg) => {
                const isOwn = msg.senderId === USERS[selectedUser].userId;
                return (
                  <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs px-4 py-2 rounded-2xl text-sm ${
                      isOwn
                        ? 'bg-blue-600 text-white rounded-br-sm'
                        : 'bg-gray-800 text-gray-100 rounded-bl-sm border border-gray-700'
                    }`}>
                      {!isOwn && <p className="text-xs text-gray-400 mb-1 font-semibold">{msg.senderId}</p>}
                      <p className="break-words">{msg.content}</p>
                      <div className="flex items-center justify-end gap-1 mt-1 opacity-70">
                        <span className="text-[10px]">{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {isOwn && (
                          <span className="text-[10px] font-bold">
                            {msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : '✓'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            {typingUsers.length > 0 && (
              <div className="flex justify-start">
                <div className="bg-gray-900 border border-gray-800 px-4 py-2 rounded-2xl rounded-bl-sm">
                  <p className="text-xs text-gray-400 italic font-mono">{typingUsers.join(', ')} is typing...</p>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-gray-800 bg-gray-900 flex gap-3 shrink-0">
            <input
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder={roomId ? 'Type a message and press Enter...' : 'Initiate chat room first to type messages'}
              disabled={!connected || !roomId}
              className="flex-1 bg-gray-950 text-gray-100 px-4 py-2.5 rounded-xl border border-gray-800 focus:outline-none focus:border-blue-500 disabled:opacity-50 text-sm font-mono"
            />
            <button
              onClick={sendMessage}
              disabled={!connected || !roomId || !input.trim()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm disabled:opacity-50 transition-all shadow-lg shadow-blue-900/40"
            >
              Send
            </button>
          </div>
        </div>

        {/* Right panel — Notification Stack + Event Logs */}
        <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col shrink-0">
          {/* Notifications */}
          <div className="h-1/3 flex flex-col border-b border-gray-800">
            <div className="px-4 py-3 border-b border-gray-800 bg-gray-950/20">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">🔔 Live Notifications</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {notifications.length === 0 ? (
                <p className="text-xs text-gray-600 text-center mt-6">No notifications received yet.</p>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} className="bg-gray-950 border border-gray-800 p-2 rounded-lg text-xs">
                    <p className="font-semibold text-gray-200">{n.title}</p>
                    <p className="text-gray-400 mt-0.5">{n.body}</p>
                    <p className="text-[10px] text-gray-600 mt-1 font-mono text-right">{new Date(n.createdAt).toLocaleTimeString()}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Event Log */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 bg-gray-950/20 flex items-center justify-between shrink-0">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">🛠️ Event Console Log</h2>
              <button onClick={() => setLogs([])} className="text-[10px] text-gray-500 hover:text-gray-300 font-mono">Clear</button>
            </div>
            <div ref={logsContainerRef} className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-[10px] bg-gray-950/40">
              {logs.map((entry, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-gray-600 shrink-0 select-none">{entry.ts}</span>
                  <span className={levelColors[entry.level]}>{entry.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
