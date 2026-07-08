'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { CommunicationSDK, Message, Call, PresenceStatus, TypingPayload } from '@realtimeplatform/sdk';

// ─── Config — update these to test ───────────────────────────────────────────
const SERVER_URL = 'https://socketrocket.duckdns.org';
const PROJECT_ID = 'app1';
const API_KEY = 'api-key-app1';

// Two test users — open in two browser tabs to test real-time
const USERS = {
  alice: { userId: 'alice', name: 'Alice 🟢' },
  bob: { userId: 'bob', name: 'Bob 🔵' },
};

// Pre-signed JWT tokens (valid 30 days) — generated via server/generate-tokens.ts
// These match jwtSecret = 'super-secret-jwt-1' from server/.env
const TOKENS: Record<string, string> = {
  alice: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhbGljZSIsInByb2plY3RJZCI6ImFwcDEiLCJpYXQiOjE3ODM0OTM5MjIsImV4cCI6MTc4NjA4NTkyMn0.zEuXUQLVDIDvr0bFuX3TcDGpM87_GJYvyPBlUk-RMps',
  bob:   'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJib2IiLCJwcm9qZWN0SWQiOiJhcHAxIiwiaWF0IjoxNzgzNDkzOTIyLCJleHAiOjE3ODYwODU5MjJ9.eVajl6X6bqCUGIp_LFn0e7SGuA2HYUiKL0WI920Hzsk',
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

  const sdkRef = useRef<CommunicationSDK | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // ── Logger ───────────────────────────────────────────────────────────────
  const log = useCallback((msg: string, level: LogLevel = 'info') => {
    setLogs(prev => [...prev.slice(-99), {
      ts: new Date().toLocaleTimeString(),
      level,
      msg,
    }]);
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

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
      await sdk.connect();
      sdkRef.current = sdk;
      setConnected(true);
      log(`Connected as ${USERS[selectedUser].name}`, 'success');

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

      // ── Notification events ──────────────────────────────────────────────
      sdk.notifications.onNew((n) => log(`🔔 Notification: ${n.title} — ${n.body}`, 'info'));

      // ── Call events ──────────────────────────────────────────────────────
      sdk.calls.onRinging((call) => {
        setActiveCall(call);
        setCallState('ringing');
        log(`📞 Incoming call from ${call.callerId}`, 'warn');
      });

      sdk.calls.onAccepted((call) => {
        setActiveCall(call);
        setCallState('accepted');
        log(`✅ Call accepted`, 'success');
      });

      sdk.calls.onRejected((p) => {
        setActiveCall(null);
        setCallState('idle');
        log(`❌ Call rejected by ${p.rejectedBy}`, 'error');
      });

      sdk.calls.onEnded((p) => {
        setActiveCall(null);
        setCallState('idle');
        log(`📵 Call ended by ${p.endedBy}`, 'warn');
      });

      sdk.calls.onMissed((p) => {
        setActiveCall(null);
        setCallState('idle');
        log(`📵 Missed call ${p.callId}`, 'warn');
      });

      sdk.calls.onBusy(() => {
        setCallState('idle');
        log('User is busy', 'warn');
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
    log('Disconnected');
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
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">🧪 SDK Test Console</h1>
          <p className="text-sm text-gray-400">Real-Time Communication Platform</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
          <span className="text-sm text-gray-300">{connected ? `Connected as ${USERS[selectedUser].name}` : 'Disconnected'}</span>
          {connected && latency > 0 && (
            <span className="text-xs bg-gray-800 px-2 py-1 rounded text-gray-400">{latency}ms</span>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — controls */}
        <div className="w-72 bg-gray-900 border-r border-gray-800 flex flex-col gap-4 p-4">
          {/* User Select */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Connect As</label>
            <div className="flex gap-2">
              {(['alice', 'bob'] as const).map(u => (
                <button
                  key={u}
                  disabled={connected}
                  onClick={() => setSelectedUser(u)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    selectedUser === u
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  } disabled:opacity-50`}
                >
                  {USERS[u].name}
                </button>
              ))}
            </div>
          </div>

          {/* Connect / Disconnect */}
          <button
            onClick={connected ? disconnect : connect}
            disabled={connecting}
            className={`w-full py-2.5 rounded-lg font-semibold text-sm transition-all ${
              connected
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-green-600 hover:bg-green-700 text-white'
            } disabled:opacity-50`}
          >
            {connecting ? 'Connecting...' : connected ? 'Disconnect' : 'Connect'}
          </button>

          {/* Room */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Private Room</label>
            <button
              onClick={joinPrivateRoom}
              disabled={!connected}
              className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50 transition-all"
            >
              Open Chat with {selectedUser === 'alice' ? 'Bob' : 'Alice'}
            </button>
            {roomId && (
              <p className="text-xs text-gray-500 mt-2 break-all">Room: {roomId.slice(0, 40)}...</p>
            )}
          </div>

          {/* Presence */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Online Users</label>
            <div className="space-y-1">
              {['alice', 'bob'].map(u => (
                <div key={u} className="flex items-center gap-2 text-sm">
                  <span className={`w-2 h-2 rounded-full ${onlineUsers.has(u) ? 'bg-green-400' : 'bg-gray-600'}`} />
                  <span className="text-gray-300">{u}</span>
                  {u === USERS[selectedUser].userId && <span className="text-xs text-gray-500">(you)</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Call Controls */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Audio Call</label>
            <div className="flex flex-col gap-2">
              {callState === 'idle' && (
                <button
                  onClick={startCall}
                  disabled={!connected || !roomId}
                  className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  📞 Call {selectedUser === 'alice' ? 'Bob' : 'Alice'}
                </button>
              )}
              {callState === 'ringing' && activeCall?.calleeId === USERS[selectedUser].userId && (
                <div className="space-y-2">
                  <p className="text-sm text-yellow-400 animate-pulse">📞 Incoming call...</p>
                  <div className="flex gap-2">
                    <button onClick={acceptCall} className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm">Accept</button>
                    <button onClick={rejectCall} className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm">Reject</button>
                  </div>
                </div>
              )}
              {callState === 'ringing' && activeCall?.callerId === USERS[selectedUser].userId && (
                <div className="space-y-2">
                  <p className="text-sm text-yellow-400 animate-pulse">📱 Calling...</p>
                  <button onClick={endCall} className="w-full py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm">Cancel</button>
                </div>
              )}
              {callState === 'accepted' && (
                <div className="space-y-2">
                  <p className="text-sm text-green-400">✅ In Call</p>
                  <button onClick={endCall} className="w-full py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm">End Call</button>
                </div>
              )}
            </div>
          </div>

          {/* Server Info */}
          <div className="mt-auto">
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Server</label>
            <p className="text-xs text-gray-600 font-mono">{SERVER_URL}</p>
            <p className="text-xs text-gray-600">Project: {PROJECT_ID}</p>
          </div>
        </div>

        {/* Center — Chat */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 ? (
              <div className="text-center text-gray-600 mt-20">
                <p className="text-4xl mb-3">💬</p>
                <p>Connect and open a room to start chatting</p>
              </div>
            ) : (
              messages.map((msg) => {
                const isOwn = msg.senderId === USERS[selectedUser].userId;
                return (
                  <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs px-4 py-2 rounded-2xl text-sm ${
                      isOwn ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-gray-800 text-gray-100 rounded-bl-sm'
                    }`}>
                      {!isOwn && <p className="text-xs text-gray-400 mb-1">{msg.senderId}</p>}
                      <p>{msg.content}</p>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <span className="text-xs opacity-60">{new Date(msg.createdAt).toLocaleTimeString()}</span>
                        {isOwn && (
                          <span className="text-xs opacity-60">
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
                <div className="bg-gray-800 px-4 py-2 rounded-2xl rounded-bl-sm">
                  <p className="text-xs text-gray-400">{typingUsers.join(', ')} typing...</p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-gray-800 flex gap-3">
            <input
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder={roomId ? 'Type a message...' : 'Open a room first'}
              disabled={!connected || !roomId}
              className="flex-1 bg-gray-800 text-gray-100 px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-blue-500 disabled:opacity-50 text-sm"
            />
            <button
              onClick={sendMessage}
              disabled={!connected || !roomId || !input.trim()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-sm disabled:opacity-50 transition-all"
            >
              Send
            </button>
          </div>
        </div>

        {/* Right panel — event log */}
        <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">Event Log</h2>
            <button onClick={() => setLogs([])} className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
            {logs.map((entry, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-gray-600 shrink-0">{entry.ts}</span>
                <span className={levelColors[entry.level]}>{entry.msg}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
