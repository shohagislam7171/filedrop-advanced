// main.js — Advanced UI wiring, Drag & Drop, Themes, and Tabs

import { FileSharePeer } from './peer.js';

// ── DOM refs ──
const myPeerIdEl      = document.getElementById('my-peer-id');
const statusMsg       = document.getElementById('status-msg');
const peersContainer  = document.getElementById('peers-container');
const themeToggle     = document.getElementById('theme-toggle');

// Modal
const sendModal       = document.getElementById('send-modal');
const closeModalBtn   = document.getElementById('close-modal-btn');
const modalPeerName   = document.getElementById('modal-peer-name');
const modalPeerAvatar = document.getElementById('modal-peer-avatar');
const sendBtn         = document.getElementById('send-btn');

// Tabs
const tabBtns         = document.querySelectorAll('.tab-btn');
const tabContents     = document.querySelectorAll('.tab-content');

// File & Text Inputs
const fileInput       = document.getElementById('file-input');
const fileNameDisplay = document.getElementById('file-name-display');
const textInput       = document.getElementById('text-input');

// Progress
const progressWrap    = document.getElementById('progress-wrap');
const progressFill    = document.getElementById('progress-fill');
const progressLabel   = document.getElementById('progress-label');
const progressFilename= document.getElementById('progress-filename');

// Receive toast
const receiveToast    = document.getElementById('receive-toast');
const toastTitle      = document.getElementById('toast-title');
const toastFile       = document.getElementById('toast-file');
const acceptBtn       = document.getElementById('accept-btn');
const declineBtn      = document.getElementById('decline-btn');

// Drag & Drop
const dragOverlay     = document.getElementById('drag-overlay');

// ── State ──
let activePeerId = null;
let currentTab   = 'file';
let selectedFile = null;
const peerNodes  = new Map();

// ── Theme Management ──
function initTheme() {
  const savedTheme = localStorage.getItem('filedrop-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
}
initTheme();

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('filedrop-theme', next);
});

// ── Copy ID ──
myPeerIdEl.addEventListener('click', () => {
  if (myPeerIdEl.textContent === 'Connecting...') return;
  navigator.clipboard.writeText(myPeerIdEl.textContent);
  const originalText = myPeerIdEl.textContent;
  myPeerIdEl.textContent = 'Copied!';
  setTimeout(() => { myPeerIdEl.textContent = originalText; }, 2000);
});

// ── Radar Positions & Avatars ──
const POSITIONS = [
  { x: 50, y: 20 }, { x: 80, y: 50 }, { x: 50, y: 80 }, { x: 20, y: 50 },
  { x: 72, y: 28 }, { x: 72, y: 72 }, { x: 28, y: 72 }, { x: 28, y: 28 },
];

function getPosition(index) { return POSITIONS[index % POSITIONS.length]; }

function peerLabel(peerId) {
  const parts = peerId.split('-');
  if (parts.length >= 2) return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  return peerId.slice(0, 10);
}

let peerCount = 0;
function addPeerNode(peerId) {
  if (peerNodes.has(peerId)) return;
  const pos = getPosition(peerCount);
  peerCount++;

  const node = document.createElement('div');
  node.className = 'node peer-node';
  node.style.left = `${pos.x}%`;
  node.style.top  = `${pos.y}%`;
  node.dataset.peerId = peerId;

  const shortName = peerLabel(peerId);
  const initial = shortName.charAt(0);

  node.innerHTML = `
    <div class="avatar">${initial}</div>
    <span class="node-label">${shortName}</span>
  `;

  node.addEventListener('click', () => openSendModal(peerId, initial));
  peersContainer.appendChild(node);
  peerNodes.set(peerId, node);

  setStatus(`${peerNodes.size} device${peerNodes.size > 1 ? 's' : ''} nearby — click to connect`, true);
}

function removePeerNode(peerId) {
  const node = peerNodes.get(peerId);
  if (node) {
    node.style.transform = 'translate(-50%, -50%) scale(0)';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 300);
    peerNodes.delete(peerId);
  }
  if (peerNodes.size === 0) setStatus('Waiting for peers on your network...', false);
  else setStatus(`${peerNodes.size} device${peerNodes.size > 1 ? 's' : ''} nearby — click to connect`, true);
}

function setStatus(text, isActive = false) {
  statusMsg.textContent = text;
  const indicator = document.querySelector('.status-indicator');
  if (isActive) indicator.classList.add('active');
  else indicator.classList.remove('active');
}

// ── Modal & Tabs ──
function openSendModal(peerId, initial = '?') {
  activePeerId = peerId;
  modalPeerName.textContent = peerLabel(peerId);
  modalPeerAvatar.textContent = initial;
  
  // Reset states
  fileInput.value = '';
  selectedFile = null;
  textInput.value = '';
  fileNameDisplay.textContent = 'Click to select or drag files here';
  sendBtn.disabled = true;
  progressWrap.classList.add('hidden');
  progressFill.style.width = '0%';
  progressLabel.textContent = '0%';
  
  sendModal.classList.remove('hidden');
}

function closeSendModal() {
  sendModal.classList.add('hidden');
  activePeerId = null;
}

closeModalBtn.addEventListener('click', closeSendModal);
sendModal.addEventListener('click', (e) => {
  if (e.target === sendModal) closeSendModal();
});

// Tab Switching
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.add('hidden'));
    tabContents.forEach(c => c.classList.remove('active'));
    
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    document.getElementById(`tab-${currentTab}`).classList.remove('hidden');
    document.getElementById(`tab-${currentTab}`).classList.add('active');
    
    checkSendReady();
  });
});

// ── File & Text Input Handling ──
fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    selectedFile = fileInput.files[0];
    const extra = fileInput.files.length > 1 ? ` (+${fileInput.files.length - 1} more)` : '';
    fileNameDisplay.textContent = selectedFile.name + extra;
    checkSendReady();
  }
});

textInput.addEventListener('input', checkSendReady);

function checkSendReady() {
  if (currentTab === 'file' && selectedFile) sendBtn.disabled = false;
  else if (currentTab === 'text' && textInput.value.trim() !== '') sendBtn.disabled = false;
  else sendBtn.disabled = true;
}

// ── Drag & Drop functionality ──
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  if(peerNodes.size > 0) dragOverlay.classList.remove('hidden');
});
document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter === 0) dragOverlay.classList.add('hidden');
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dragOverlay.classList.add('hidden');
  
  if (peerNodes.size === 0) return alert('No peers nearby to send files to!');
  
  if (e.dataTransfer.files.length > 0) {
    selectedFile = e.dataTransfer.files[0];
    // If modal is closed, open it with the first available peer
    if (!activePeerId) {
      const firstPeer = Array.from(peerNodes.keys())[0];
      openSendModal(firstPeer, peerLabel(firstPeer).charAt(0));
    }
    
    // Switch to file tab
    document.querySelector('[data-tab="file"]').click();
    const extra = e.dataTransfer.files.length > 1 ? ` (+${e.dataTransfer.files.length - 1} more)` : '';
    fileNameDisplay.textContent = selectedFile.name + extra;
    checkSendReady();
  }
});

// ── Sending Logic ──
sendBtn.addEventListener('click', () => {
  if (!activePeerId) return;

  if (currentTab === 'text') {
    // Send Text
    fsp.sendText(activePeerId, textInput.value);
    sendBtn.innerHTML = 'Sent! <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    setTimeout(closeSendModal, 1000);
    return;
  }

  // Send File
  if (!selectedFile) return;
  
  sendBtn.disabled = true;
  tabBtns.forEach(b => b.disabled = true);
  progressWrap.classList.remove('hidden');
  progressFilename.textContent = `Sending ${selectedFile.name}...`;

  try {
    fsp.sendFile(activePeerId, selectedFile, (pct) => {
      progressFill.style.width = `${pct}%`;
      progressLabel.textContent = `${pct}%`;
      if (pct === 100) {
        progressFilename.textContent = 'Done!';
        setTimeout(() => {
          closeSendModal();
          tabBtns.forEach(b => b.disabled = false);
          sendBtn.innerHTML = `<span>Send</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
        }, 1000);
      }
    });
  } catch (err) {
    alert('Transfer failed: ' + err.message);
    closeSendModal();
  }
});

// ── Receive UI ──
let incomingType = 'file'; // or 'text'
let incomingText = '';

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

acceptBtn.addEventListener('click', () => {
  if (incomingType === 'text') {
    navigator.clipboard.writeText(incomingText);
    acceptBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    setTimeout(() => {
      receiveToast.classList.add('hidden');
      acceptBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'; // reset to copy icon
    }, 1000);
  } else {
    fsp.acceptFile();
    receiveToast.classList.add('hidden');
  }
});

declineBtn.addEventListener('click', () => {
  if (incomingType === 'file') fsp.declineFile();
  receiveToast.classList.add('hidden');
});

// ── PeerJS Initialization ──
const fsp = new FileSharePeer({
  onReady(id) {
    myPeerIdEl.textContent = id;
    setStatus('Waiting for peers on your network...', false);
  },
  onPeerJoin(peerId) { addPeerNode(peerId); },
  onPeerLeave(peerId) { removePeerNode(peerId); },
  
  // When a file is offered
  onFileOffer(peerId, meta) {
    incomingType = 'file';
    toastTitle.textContent = `Incoming File from ${peerLabel(peerId)}`;
    toastFile.textContent  = `${meta.name} (${formatBytes(meta.size)})`;
    acceptBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    receiveToast.classList.remove('hidden');
  },
  
  // When text/link is offered
  onTextOffer(peerId, text) {
    incomingType = 'text';
    incomingText = text;
    toastTitle.textContent = `Message from ${peerLabel(peerId)}`;
    toastFile.textContent  = text.length > 30 ? text.substring(0, 30) + '...' : text;
    // Change Accept button to a Copy icon
    acceptBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    receiveToast.classList.remove('hidden');
  },
  
  onProgress(peerId, pct, direction) {
    // Optional: show receive progress
  },
  onError(msg) {
    setStatus('Error: ' + msg, false);
  }
});