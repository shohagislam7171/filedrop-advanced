// frontend/peer.js — Advanced WebRTC, Trickle ICE, File & Text Transfer

const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk for stable transfer
const DEFAULT_ROOM = 'filedrop-pro-room';

// Automatically select local signaling server for testing, or live server for production
const SIGNAL_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV)
  ? `ws://${location.hostname}:8787/signal`
  : 'wss://filedrop-signaling.abdullah21673.workers.dev/signal';

function getRoomId() {
  return window.location.hash.replace('#', '').trim() || DEFAULT_ROOM;
}

// Generate a premium readable ID
function genId() {
  const adj  = ['neon','cyber','swift','calm','bold','nova','wise','zen'];
  const noun = ['fox','kite','oak','reef','star','lake','wolf','bird'];
  const n = Math.floor(Math.random() * 900 + 100);
  return `${adj[Math.floor(Math.random() * adj.length)]}-${noun[Math.floor(Math.random() * noun.length)]}-${n}`;
}

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' } // Added fallback STUN server
  ],
};

export class FileSharePeer {
  constructor({ onReady, onPeerJoin, onPeerLeave, onFileOffer, onTextOffer, onProgress, onError }) {
    this.onReady     = onReady;
    this.onPeerJoin  = onPeerJoin;
    this.onPeerLeave = onPeerLeave;
    this.onFileOffer = onFileOffer;
    this.onTextOffer = onTextOffer; // New event for Text/Links
    this.onProgress  = onProgress;
    this.onError     = onError;

    this.myId            = genId();
    this.ws              = null;
    this.peerConns       = new Map();  // peerId → { pc, iceCandidateQueue, remoteDescSet }
    this.dataChannels    = new Map();
    this.pendingReceive  = null;
    this._receiveBuffers = new Map();

    this._connect();
  }

  _connect() {
    const room = getRoomId();
    const url  = `${SIGNAL_URL}?peerId=${this.myId}&room=${room}`;
    console.log('[signal] Connecting to', url);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[signal] Connected successfully');
      this.onReady(this.myId);
    };

    this.ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'PEER_LIST') {
        for (const peerId of msg.peers) {
          await this._createOffer(peerId);
        }
      }

      if (msg.type === 'PEER_JOINED') {
        console.log('[signal] Peer joined, waiting for offer:', msg.peerId);
      }

      if (msg.type === 'PEER_LEFT') {
        this._removePeer(msg.peerId);
      }

      if (msg.type === 'offer') {
        await this._handleOffer(msg.from, msg.sdp);
      }

      if (msg.type === 'answer') {
        await this._handleAnswer(msg.from, msg.sdp);
      }

      if (msg.type === 'ice') {
        await this._handleIce(msg.from, msg.candidate);
      }
    };

    this.ws.onclose = (e) => {
      console.log('[signal] Connection closed, retrying...', e.code);
      setTimeout(() => this._connect(), 3000);
    };

    this.ws.onerror = () => {
      this.onError('Signaling connection failed');
    };
  }

  _signal(to, msg) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...msg, to }));
    }
  }

  // ── Connection Setup ──
  _createPC(peerId) {
    if (this.peerConns.has(peerId)) return this.peerConns.get(peerId);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const entry = { pc, iceCandidateQueue: [], remoteDescSet: false };
    this.peerConns.set(peerId, entry);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._signal(peerId, { type: 'ice', candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {      
      if (pc.connectionState === 'connected') {
        this.onPeerJoin(peerId);
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this._removePeer(peerId);
      }
    };

    return entry;
  }

  async _createOffer(peerId) {
    const { pc } = this._createPC(peerId);
    const dc = pc.createDataChannel('filedrop', { ordered: true });
    this._bindDataChannel(dc, peerId);
    this.dataChannels.set(peerId, dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this._signal(peerId, { type: 'offer', sdp: pc.localDescription.sdp });
  }

  async _handleOffer(peerId, sdp) {
    const entry = this._createPC(peerId);
    const { pc } = entry;

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      this.dataChannels.set(peerId, dc);
      this._bindDataChannel(dc, peerId);
    };

    await pc.setRemoteDescription({ type: 'offer', sdp });
    entry.remoteDescSet = true;

    for (const candidate of entry.iceCandidateQueue) {
      try { await pc.addIceCandidate(candidate); } catch (e) {}
    }
    entry.iceCandidateQueue = [];

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this._signal(peerId, { type: 'answer', sdp: pc.localDescription.sdp });
  }

  async _handleAnswer(peerId, sdp) {
    const entry = this.peerConns.get(peerId);
    if (!entry) return;
    
    await entry.pc.setRemoteDescription({ type: 'answer', sdp });
    entry.remoteDescSet = true;

    for (const candidate of entry.iceCandidateQueue) {
      try { await entry.pc.addIceCandidate(candidate); } catch (e) {}
    }
    entry.iceCandidateQueue = [];
  }

  async _handleIce(peerId, candidate) {
    if (!candidate) return;
    const entry = this.peerConns.get(peerId);
    if (!entry) return;

    if (!entry.remoteDescSet) {
      entry.iceCandidateQueue.push(candidate);
    } else {
      try { await entry.pc.addIceCandidate(candidate); } catch (e) { }
    }
  }

  _bindDataChannel(dc, peerId) {
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (event) => this._handleMessage(peerId, event.data);
  }

  // ── Text Transfer (New Feature) ──
  sendText(peerId, text) {
    const dc = this.dataChannels.get(peerId);
    if (!dc || dc.readyState !== 'open') throw new Error('Not connected');
    dc.send(JSON.stringify({ type: 'TEXT_OFFER', text: text }));
  }

  // ── File Transfer ──
  sendFile(peerId, file, onProgress) {
    const dc = this.dataChannels.get(peerId);
    if (!dc || dc.readyState !== 'open') throw new Error('Not connected');

    dc.send(JSON.stringify({ type: 'FILE_OFFER', name: file.name, size: file.size, mime: file.type }));

    let offset = 0;
    const reader = new FileReader();

    const readNext = () => reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK_SIZE));

    reader.onload = (e) => {
      dc.send(e.target.result);
      offset += e.target.result.byteLength;
      const pct = Math.round((offset / file.size) * 100);
      onProgress(pct);
      
      if (offset < file.size) {
        if (dc.bufferedAmount > 1024 * 1024) {
          setTimeout(readNext, 50);
        } else {
          readNext();
        }
      } else {
        dc.send(JSON.stringify({ type: 'FILE_DONE' }));
        onProgress(100);
      }
    };

    readNext();
  }

  acceptFile() {
    if (!this.pendingReceive) return;
    const { peerId } = this.pendingReceive;
    this.pendingReceive.resolve();
    const state = this._receiveBuffers.get(peerId);
    if (state && state.done) this._triggerDownload(peerId);
  }

  declineFile() {
    if (this.pendingReceive) {
      const dc = this.dataChannels.get(this.pendingReceive.peerId);
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify({ type: 'FILE_DECLINED' }));
      }
      this.pendingReceive.reject();
      this.pendingReceive = null;
    }
  }

  _triggerDownload(senderId) {
    const state = this._receiveBuffers.get(senderId);
    if (!state) return;
    const blob = new Blob(state.chunks, { type: state.meta.mime || 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = state.meta.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    this._receiveBuffers.delete(senderId);
    this.onProgress(senderId, 100, 'receive');
  }

  _handleMessage(peerId, data) {
    if (typeof data === 'string') {
      const msg = JSON.parse(data);

      // Handle Text Receiving
      if (msg.type === 'TEXT_OFFER') {
        if(this.onTextOffer) this.onTextOffer(peerId, msg.text);
        return;
      }

      // Handle File Receiving
      if (msg.type === 'FILE_OFFER') {
        this._receiveBuffers.set(peerId, { chunks: [], meta: msg, accepted: false, done: false });
        this.pendingReceive = {
          peerId,
          meta: msg,
          resolve: () => {
            const state = this._receiveBuffers.get(peerId);
            if (state) state.accepted = true;
            this.pendingReceive = null;
          },
          reject: () => {
            this._receiveBuffers.delete(peerId);
            this.pendingReceive = null;
          }
        };
        this.onFileOffer(peerId, msg);
      }

      if (msg.type === 'FILE_DONE') {
        const state = this._receiveBuffers.get(peerId);
        if (!state) return;
        state.done = true;
        if (state.accepted) this._triggerDownload(peerId);
      }

    } else {
      // Chunk receiving
      const state = this._receiveBuffers.get(peerId);
      if (!state) return;
      state.chunks.push(data);
      const received = state.chunks.reduce((a, c) => a + c.byteLength, 0);
      this.onProgress(peerId, Math.round((received / state.meta.size) * 100), 'receive');
    }
  }

  _removePeer(peerId) {
    const entry = this.peerConns.get(peerId);
    if (entry) entry.pc.close();
    this.peerConns.delete(peerId);
    this.dataChannels.delete(peerId);
    this._receiveBuffers.delete(peerId);
    this.onPeerLeave(peerId);
  }
}