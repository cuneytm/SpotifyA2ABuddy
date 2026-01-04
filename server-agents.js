/**
 * 🎵 MUSIC BUDDY - MULTI-AGENT ARCHITECTURE WITH A2A PROTOCOL
 * 
 * Implements Google's Agent-to-Agent (A2A) Protocol for agent communication
 * https://google.github.io/A2A/
 * 
 * Agents:
 * 1. Orchestrator Agent - Coordinates all agents, manages user session
 * 2. Speech Agent - Handles STT (Whisper) and TTS (OpenAI)
 * 3. Conversation Agent - Understands user intent, extracts commands
 * 4. Sentiment Agent - Analyzes mood for music recommendations
 * 5. Spotify Agent - Manages all Spotify operations
 * 
 * Communication: A2A Protocol over Event-based message bus
 */

import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import OpenAI, { toFile } from 'openai';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================== OPENAI CLIENT ==================
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ================== MODEL CONFIGURATION ==================
// Use latest models (as of Jan 2026)
const MODELS = {
  INTENT_DETECTION: 'gpt-4o',           // Best for function calling
  SENTIMENT_ANALYSIS: 'gpt-4o',          // Upgraded from gpt-4o-mini for better accuracy
  CHAT_RESPONSE: 'gpt-4o',               // Conversational responses
  TTS_MODEL: 'tts-1-hd',                 // Higher quality TTS
  TTS_VOICE: 'nova',                     // Natural sounding voice
  WHISPER_MODEL: 'whisper-1'             // Speech to text
};

// ================== LOGGING ==================
const LOG_FILE = path.join(__dirname, 'server.log');

// Create/clear log file on startup
fs.writeFileSync(LOG_FILE, `=== Music Buddy Server Started at ${new Date().toISOString()} ===\n\n`);

function log(level, agent, message, data = null) {
  const timestamp = new Date().toISOString().substr(11, 12);
  const fullTimestamp = new Date().toISOString();
  const colors = {
    'INFO': '\x1b[36m',
    'DEBUG': '\x1b[90m',
    'ERROR': '\x1b[31m',
    'AGENT': '\x1b[35m',
    'SUCCESS': '\x1b[32m',
    'A2A': '\x1b[33m'  // Yellow for A2A protocol messages
  };
  const color = colors[level] || '\x1b[0m';
  
  // Console output with colors
  console.log(`${color}[${timestamp}] [${agent}] ${message}\x1b[0m`, data || '');
  
  // File output without colors
  const logLine = `[${fullTimestamp}] [${level}] [${agent}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
  fs.appendFileSync(LOG_FILE, logLine);
}

// Enhanced A2A logging
function logA2A(type, data) {
  const timestamp = new Date().toISOString();
  const separator = '─'.repeat(60);
  
  // Pretty print to console
  console.log('\x1b[33m' + separator);
  console.log(`🔗 A2A ${type.toUpperCase()} @ ${timestamp}`);
  console.log(JSON.stringify(data, null, 2));
  console.log(separator + '\x1b[0m');
  
  // Write to log file
  const logEntry = `\n${separator}\n🔗 A2A ${type.toUpperCase()} @ ${timestamp}\n${JSON.stringify(data, null, 2)}\n${separator}\n`;
  fs.appendFileSync(LOG_FILE, logEntry);
}

// ================== SPOTIFY TOKEN MANAGEMENT ==================
const TOKEN_FILE = path.join(__dirname, '.spotify-tokens.json');
let spotifyTokens = null;
let webPlaybackDeviceId = null;

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      spotifyTokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      log('INFO', 'SPOTIFY', 'Tokens loaded');
    }
  } catch (e) {
    log('ERROR', 'SPOTIFY', 'Token load error', e.message);
  }
}

async function refreshSpotifyToken() {
  if (!spotifyTokens?.refresh_token) {
    throw new Error('No refresh token');
  }
  
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: spotifyTokens.refresh_token
    })
  });
  
  const data = await response.json();
  spotifyTokens.access_token = data.access_token;
  spotifyTokens.expires_at = Date.now() + (data.expires_in * 1000);
  
  if (data.refresh_token) {
    spotifyTokens.refresh_token = data.refresh_token;
  }
  
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(spotifyTokens, null, 2));
  return spotifyTokens.access_token;
}

async function getValidToken() {
  if (!spotifyTokens) {
    throw new Error('No Spotify token');
  }
  
  if (Date.now() >= spotifyTokens.expires_at - 60000) {
    return await refreshSpotifyToken();
  }
  
  return spotifyTokens.access_token;
}

loadTokens();

// ================== MESSAGE BUS ==================
class MessageBus {
  constructor() {
    this.subscribers = new Map();
  }
  
  subscribe(event, callback) {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, []);
    }
    this.subscribers.get(event).push(callback);
  }
  
  publish(event, data) {
    // Skip noisy audio events from logging
    if (event !== 'audio:received') {
      log('DEBUG', 'BUS', `Event: ${event}`);
    }
    const handlers = this.subscribers.get(event) || [];
    handlers.forEach(handler => handler(data));
  }
}

const messageBus = new MessageBus();

// ================== A2A PROTOCOL IMPLEMENTATION ==================
/**
 * Agent-to-Agent (A2A) Protocol Implementation
 * Based on Google's A2A specification
 */

// A2A Task States
const TaskState = {
  SUBMITTED: 'submitted',
  WORKING: 'working',
  INPUT_REQUIRED: 'input-required',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled'
};

// A2A Message Types
const MessageType = {
  TASK_SEND: 'tasks/send',
  TASK_GET: 'tasks/get',
  TASK_CANCEL: 'tasks/cancel',
  TASK_STATUS: 'tasks/sendSubscribe'
};

// Generate unique task ID
function generateTaskId() {
  return `task_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

// A2A Agent Card - Describes agent capabilities
class AgentCard {
  constructor(config) {
    this.name = config.name;
    this.description = config.description;
    this.url = config.url || null;
    this.version = config.version || '1.0.0';
    this.provider = config.provider || { organization: 'MusicBuddy' };
    this.capabilities = config.capabilities || {};
    this.skills = config.skills || [];
    this.authentication = config.authentication || { schemes: [] };
    this.defaultInputModes = config.defaultInputModes || ['text'];
    this.defaultOutputModes = config.defaultOutputModes || ['text'];
  }
  
  toJSON() {
    return {
      name: this.name,
      description: this.description,
      url: this.url,
      version: this.version,
      provider: this.provider,
      capabilities: this.capabilities,
      skills: this.skills,
      authentication: this.authentication,
      defaultInputModes: this.defaultInputModes,
      defaultOutputModes: this.defaultOutputModes
    };
  }
}

// A2A Task - Represents a unit of work
class A2ATask {
  constructor(skillId, input, sessionId) {
    this.id = generateTaskId();
    this.sessionId = sessionId;
    this.skillId = skillId;
    this.input = input;
    this.state = TaskState.SUBMITTED;
    this.output = null;
    this.error = null;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.history = [];
  }
  
  updateState(newState, message = null) {
    this.state = newState;
    this.updatedAt = Date.now();
    this.history.push({
      state: newState,
      timestamp: this.updatedAt,
      message
    });
  }
  
  complete(output) {
    this.output = output;
    this.updateState(TaskState.COMPLETED);
  }
  
  fail(error) {
    this.error = error;
    this.updateState(TaskState.FAILED, error);
  }
  
  toJSON() {
    return {
      id: this.id,
      sessionId: this.sessionId,
      skillId: this.skillId,
      state: this.state,
      input: this.input,
      output: this.output,
      error: this.error,
      history: this.history
    };
  }
}

// A2A Message - JSON-RPC 2.0 format
class A2AMessage {
  static createRequest(method, params, id = null) {
    return {
      jsonrpc: '2.0',
      id: id || generateTaskId(),
      method,
      params
    };
  }
  
  static createResponse(id, result) {
    return {
      jsonrpc: '2.0',
      id,
      result
    };
  }
  
  static createError(id, code, message, data = null) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message, data }
    };
  }
}

// A2A Protocol Handler - Routes messages between agents
class A2AProtocolHandler {
  constructor(bus) {
    this.bus = bus;
    this.agents = new Map(); // agentId -> AgentCard
    this.tasks = new Map();  // taskId -> A2ATask
    this.agentHandlers = new Map(); // skillId -> handler function
    
    // Subscribe to A2A events
    bus.subscribe('a2a:task:send', (data) => this.handleTaskSend(data));
    bus.subscribe('a2a:task:complete', (data) => this.handleTaskComplete(data));
    bus.subscribe('a2a:task:fail', (data) => this.handleTaskFail(data));
    
    log('A2A', 'PROTOCOL', 'A2A Protocol Handler initialized');
  }
  
  // Register an agent with its capabilities
  registerAgent(agentId, card, handlers = {}) {
    this.agents.set(agentId, card);
    
    // Register skill handlers
    for (const skill of card.skills) {
      if (handlers[skill.id]) {
        this.agentHandlers.set(skill.id, handlers[skill.id]);
      }
    }
    
    log('A2A', 'PROTOCOL', `Agent registered: ${card.name}`, { skills: card.skills.map(s => s.id) });
  }
  
  // Get agent card (for discovery)
  getAgentCard(agentId) {
    return this.agents.get(agentId)?.toJSON();
  }
  
  // List all registered agents
  listAgents() {
    return Array.from(this.agents.entries()).map(([id, card]) => ({
      id,
      ...card.toJSON()
    }));
  }
  
  // Send a task to an agent
  async sendTask(skillId, input, sessionId) {
    const task = new A2ATask(skillId, input, sessionId);
    this.tasks.set(task.id, task);
    
    log('A2A', 'PROTOCOL', `Task created: ${task.id}`, { skillId, input });
    
    // Find handler for this skill
    const handler = this.agentHandlers.get(skillId);
    if (!handler) {
      task.fail(`No handler for skill: ${skillId}`);
      return task;
    }
    
    // Execute the task
    task.updateState(TaskState.WORKING);
    
    try {
      const result = await handler(input, sessionId, task);
      task.complete(result);
    } catch (error) {
      task.fail(error.message);
    }
    
    return task;
  }
  
  // Handle incoming task send events
  async handleTaskSend(data) {
    const { skillId, input, sessionId, responseEvent } = data;
    const task = await this.sendTask(skillId, input, sessionId);
    
    // Publish result if response event specified
    if (responseEvent) {
      this.bus.publish(responseEvent, {
        sessionId,
        task: task.toJSON(),
        result: task.output,
        error: task.error
      });
    }
    
    return task;
  }
  
  handleTaskComplete(data) {
    const { taskId, output } = data;
    const task = this.tasks.get(taskId);
    if (task) {
      task.complete(output);
      log('A2A', 'PROTOCOL', `Task completed: ${taskId}`);
    }
  }
  
  handleTaskFail(data) {
    const { taskId, error } = data;
    const task = this.tasks.get(taskId);
    if (task) {
      task.fail(error);
      log('A2A', 'PROTOCOL', `Task failed: ${taskId}`, error);
    }
  }
  
  // Get task status
  getTask(taskId) {
    return this.tasks.get(taskId)?.toJSON();
  }
}

// Global A2A Protocol Handler
let a2aProtocol;

// ================== RESPONSE MANAGER ==================
// Prevents duplicate responses for the same user input
class ResponseManager {
  constructor() {
    this.pendingResponses = new Map(); // sessionId -> { locked: boolean, queue: [] }
    this.lastResponseTime = new Map(); // sessionId -> timestamp
  }
  
  // Check if we can send a response (not locked)
  canRespond(sessionId) {
    const pending = this.pendingResponses.get(sessionId);
    if (!pending) return true;
    return !pending.locked;
  }
  
  // Lock responses for this session (when processing an intent)
  lock(sessionId) {
    this.pendingResponses.set(sessionId, { locked: true, queue: [] });
  }
  
  // Unlock and clear for next interaction
  unlock(sessionId) {
    this.pendingResponses.delete(sessionId);
    this.lastResponseTime.set(sessionId, Date.now());
  }
  
  // Check if enough time has passed since last response (debounce)
  shouldDebounce(sessionId, minGapMs = 2000) {
    const lastTime = this.lastResponseTime.get(sessionId);
    if (!lastTime) return false;
    return (Date.now() - lastTime) < minGapMs;
  }
}

const responseManager = new ResponseManager();

// ================== AGENT: SPOTIFY (A2A Enabled) ==================
class SpotifyAgent {
  constructor(bus) {
    this.bus = bus;
    this.name = 'SPOTIFY_AGENT';
    
    // A2A Agent Card
    this.agentCard = new AgentCard({
      name: 'SpotifyAgent',
      description: 'Controls Spotify music playback including play, pause, skip, and search',
      version: '2.0.0',
      capabilities: {
        streaming: true,
        pushNotifications: true
      },
      skills: [
        {
          id: 'play_music',
          name: 'Play Music',
          description: 'Search and play music by song name, artist, or query',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query (song, artist, album)' }
            },
            required: ['query']
          }
        },
        {
          id: 'pause_music',
          name: 'Pause Music',
          description: 'Pause current playback'
        },
        {
          id: 'resume_music',
          name: 'Resume Music',
          description: 'Resume paused playback'
        },
        {
          id: 'skip_next',
          name: 'Skip to Next',
          description: 'Skip to the next track'
        },
        {
          id: 'skip_previous',
          name: 'Skip to Previous',
          description: 'Go back to the previous track'
        },
        {
          id: 'set_volume',
          name: 'Set Volume',
          description: 'Set playback volume',
          parameters: {
            type: 'object',
            properties: {
              level: { type: 'number', minimum: 0, maximum: 100 }
            },
            required: ['level']
          }
        },
        {
          id: 'get_current_track',
          name: 'Get Current Track',
          description: 'Get information about currently playing track'
        },
        {
          id: 'play_by_mood',
          name: 'Play by Mood',
          description: 'Play music matching a mood or genre',
          parameters: {
            type: 'object',
            properties: {
              mood: { type: 'string', enum: ['happy', 'sad', 'energetic', 'calm', 'angry', 'romantic', 'focused', 'party'] }
            },
            required: ['mood']
          }
        }
      ],
      defaultInputModes: ['text'],
      defaultOutputModes: ['text', 'audio']
    });
    
    // Register with A2A Protocol
    if (a2aProtocol) {
      a2aProtocol.registerAgent('spotify', this.agentCard, {
        'play_music': (input) => this.playMusic(input.query, this.getDeviceParam()),
        'pause_music': () => this.spotifyAPI(`/me/player/pause${this.getDeviceParam()}`, 'PUT'),
        'resume_music': () => this.spotifyAPI(`/me/player/play${this.getDeviceParam()}`, 'PUT'),
        'skip_next': () => this.skipToNext(this.getDeviceParam()),
        'skip_previous': () => this.spotifyAPI(`/me/player/previous${this.getDeviceParam()}`, 'POST'),
        'set_volume': (input) => this.spotifyAPI(`/me/player/volume?volume_percent=${input.level}${webPlaybackDeviceId ? '&device_id=' + webPlaybackDeviceId : ''}`, 'PUT'),
        'get_current_track': () => this.getCurrentTrack(),
        'play_by_mood': (input) => this.playByMood(input.mood, this.getDeviceParam())
      });
    }
    
    bus.subscribe('spotify:command', (data) => this.handleCommand(data));
    
    log('AGENT', this.name, 'Initialized with A2A support');
  }
  
  getDeviceParam() {
    return webPlaybackDeviceId ? `?device_id=${webPlaybackDeviceId}` : '';
  }
  
  async spotifyAPI(endpoint, method = 'GET', body = null) {
    const token = await getValidToken();
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const url = endpoint.startsWith('http') ? endpoint : `https://api.spotify.com/v1${endpoint}`;
    log('AGENT', this.name, `API Call: ${method} ${url}`);
    
    const response = await fetch(url, options);
    
    log('AGENT', this.name, `API Response: ${response.status}`);
    
    if (response.status === 204) return { success: true };
    
    if (response.ok) {
      const text = await response.text();
      if (!text) return { success: true };
      try {
        return JSON.parse(text);
      } catch {
        return { success: true };
      }
    }
    
    const error = await response.text();
    log('ERROR', this.name, `API Error: ${response.status} - ${error}`);
    throw new Error(`Spotify API error: ${response.status} - ${error}`);
  }
  
  async handleCommand(data) {
    const { command, args, sessionId } = data;
    log('AGENT', this.name, `Command: ${command}`, args);
    
    try {
      let result;
      const deviceParam = webPlaybackDeviceId ? `?device_id=${webPlaybackDeviceId}` : '';
      
      switch (command) {
        case 'play_music':
          result = await this.playMusic(args.query, deviceParam);
          break;
          
        case 'pause':
          await this.spotifyAPI(`/me/player/pause${deviceParam}`, 'PUT');
          result = { success: true, message: 'Music paused' };
          break;
          
        case 'resume':
          await this.spotifyAPI(`/me/player/play${deviceParam}`, 'PUT');
          result = { success: true, message: 'Music resumed' };
          break;
          
        case 'next':
          log('AGENT', this.name, `Skipping to next track, device: ${webPlaybackDeviceId}`);
          result = await this.skipToNext(deviceParam);
          break;
          
        case 'previous':
          log('AGENT', this.name, `Going to previous track, device: ${webPlaybackDeviceId}`);
          if (webPlaybackDeviceId) {
            await this.ensureDeviceActive(webPlaybackDeviceId);
          }
          await this.spotifyAPI(`/me/player/previous${deviceParam}`, 'POST');
          await new Promise(r => setTimeout(r, 500));
          const prevTrack = await this.getCurrentTrack();
          result = { 
            success: true, 
            message: prevTrack.track ? `Now playing: ${prevTrack.track.name}` : 'Playing previous track'
          };
          break;
          
        case 'volume':
          await this.spotifyAPI(`/me/player/volume?volume_percent=${args.level}${webPlaybackDeviceId ? '&device_id=' + webPlaybackDeviceId : ''}`, 'PUT');
          result = { success: true, message: `Volume set to ${args.level}%` };
          break;
          
        case 'current_track':
          result = await this.getCurrentTrack();
          break;
          
        case 'play_mood':
          result = await this.playByMood(args.mood, deviceParam);
          break;
          
        default:
          result = { success: false, message: `Unknown command: ${command}` };
      }
      
      this.bus.publish('spotify:result', { sessionId, result });
      
    } catch (error) {
      log('ERROR', this.name, 'Command failed', error.message);
      this.bus.publish('spotify:result', { 
        sessionId, 
        result: { success: false, message: error.message }
      });
    }
  }
  
  async playMusic(query, deviceParam) {
    // Ensure device is active before playing
    try {
      const targetDeviceId = await this.ensureDeviceActive(webPlaybackDeviceId);
      deviceParam = `?device_id=${targetDeviceId}`;
    } catch (e) {
      return { success: false, message: e.message };
    }
    
    // Search for multiple tracks to create a queue for "next" to work
    const searchResult = await this.spotifyAPI(`/search?q=${encodeURIComponent(query)}&type=track&limit=20&market=US`);
    
    if (!searchResult.tracks?.items?.length) {
      return { success: false, message: 'Song not found' };
    }
    
    const tracks = searchResult.tracks.items;
    const trackUris = tracks.map(t => t.uri);
    const firstTrack = tracks[0];
    
    // Store the current track info for next detection
    this.lastPlayedQuery = query;
    this.lastTrackUri = firstTrack.uri;
    
    // Play all tracks - this creates a queue so "next" will work
    await this.spotifyAPI(`/me/player/play${deviceParam}`, 'PUT', {
      uris: trackUris
    });
    
    log('AGENT', this.name, `Playing ${trackUris.length} tracks starting with: ${firstTrack.name}`);
    
    return { 
      success: true, 
      message: `Now playing "${firstTrack.name}" by ${firstTrack.artists[0].name}`,
      track: { name: firstTrack.name, artist: firstTrack.artists[0].name }
    };
  }
  
  async getCurrentTrack() {
    const result = await this.spotifyAPI('/me/player/currently-playing');
    
    if (!result?.item) {
      return { success: true, message: 'Nothing playing right now', track: null };
    }
    
    return {
      success: true,
      message: `Currently playing "${result.item.name}" by ${result.item.artists[0].name}`,
      track: {
        name: result.item.name,
        artist: result.item.artists[0].name,
        album: result.item.album?.name
      }
    };
  }
  
  async ensureDeviceActive(deviceId = null) {
    try {
      // Always get fresh list of available devices
      const devices = await this.spotifyAPI('/me/player/devices');
      log('AGENT', this.name, `Available devices: ${JSON.stringify(devices.devices?.map(d => ({ name: d.name, id: d.id, active: d.is_active })) || [])}`);
      
      if (!devices.devices || devices.devices.length === 0) {
        throw new Error('No active Spotify device found. Please open Spotify app or refresh browser.');
      }
      
      let targetDeviceId = deviceId || webPlaybackDeviceId;
      
      // Check if the stored device ID is still valid
      if (targetDeviceId) {
        const deviceExists = devices.devices.some(d => d.id === targetDeviceId);
        if (!deviceExists) {
          log('AGENT', this.name, `Stored device ${targetDeviceId} not found, selecting from available devices`);
          targetDeviceId = null;
        }
      }
      
      // If no valid device ID, select from available devices
      if (!targetDeviceId) {
        const activeDevice = devices.devices.find(d => d.is_active) || devices.devices[0];
        targetDeviceId = activeDevice.id;
        // Update the global device ID
        webPlaybackDeviceId = targetDeviceId;
        log('AGENT', this.name, `Selected device: ${activeDevice.name} (${targetDeviceId})`);
      }
      
      // Transfer playback to the target device
      log('AGENT', this.name, `Transferring playback to device: ${targetDeviceId}`);
      await this.spotifyAPI('/me/player', 'PUT', {
        device_ids: [targetDeviceId],
        play: false // Don't auto-play, just transfer
      });
      await new Promise(r => setTimeout(r, 300));
      
      return targetDeviceId;
    } catch (error) {
      log('AGENT', this.name, `Device activation warning: ${error.message}`);
      throw error; // Re-throw so caller knows about the failure
    }
  }
  
  async skipToNext(deviceParam) {
    // Get current track before skip
    const beforeTrack = await this.getCurrentTrack();
    const beforeUri = beforeTrack.track?.name;
    
    // Ensure device is active
    if (webPlaybackDeviceId) {
      await this.ensureDeviceActive(webPlaybackDeviceId);
    }
    
    // Try the standard next command
    try {
      await this.spotifyAPI(`/me/player/next${deviceParam}`, 'POST');
      await new Promise(r => setTimeout(r, 800));
    } catch (e) {
      log('AGENT', this.name, `Next command failed: ${e.message}`);
    }
    
    // Check if track actually changed
    const afterTrack = await this.getCurrentTrack();
    const afterUri = afterTrack.track?.name;
    
    // If track didn't change, search for a different song
    if (beforeUri && afterUri && beforeUri === afterUri) {
      log('AGENT', this.name, 'Track did not change, searching for a new song...');
      
      // Search for different music - use genre/random search
      const searches = [
        'popular hits 2024',
        'top songs',
        'trending music',
        'new releases',
        'chill vibes'
      ];
      const randomSearch = searches[Math.floor(Math.random() * searches.length)];
      
      const searchResult = await this.spotifyAPI(`/search?q=${encodeURIComponent(randomSearch)}&type=track&limit=20&market=US`);
      
      if (searchResult.tracks?.items?.length > 0) {
        // Pick a random track from results
        const randomIndex = Math.floor(Math.random() * Math.min(10, searchResult.tracks.items.length));
        const tracks = searchResult.tracks.items.slice(randomIndex);
        const trackUris = tracks.map(t => t.uri);
        const newTrack = tracks[0];
        
        await this.spotifyAPI(`/me/player/play${deviceParam}`, 'PUT', {
          uris: trackUris
        });
        
        this.lastPlayedQuery = randomSearch;
        this.lastTrackUri = newTrack.uri;
        
        log('AGENT', this.name, `Playing new track: ${newTrack.name}`);
        return {
          success: true,
          message: `Now playing "${newTrack.name}" by ${newTrack.artists[0].name}`
        };
      }
    }
    
    return {
      success: true,
      message: afterTrack.track ? `Now playing: ${afterTrack.track.name}` : 'Skipped to next track'
    };
  }
  
  async playByMood(mood, deviceParam) {
    // Ensure device is active before playing
    try {
      const targetDeviceId = await this.ensureDeviceActive(webPlaybackDeviceId);
      deviceParam = `?device_id=${targetDeviceId}`;
    } catch (e) {
      return { success: false, message: e.message };
    }
    
    const moodToSearch = {
      happy: 'happy upbeat pop hits',
      sad: 'sad emotional acoustic',
      energetic: 'energetic workout dance',
      calm: 'calm relaxing ambient',
      angry: 'rock metal intense',
      romantic: 'romantic love songs',
      focused: 'focus study concentration',
      party: 'party dance hits'
    };
    
    const searchQuery = moodToSearch[mood] || 'popular hits';
    
    // First try to find a playlist
    let searchResult = await this.spotifyAPI(`/search?q=${encodeURIComponent(searchQuery)}&type=playlist&limit=1&market=US`);
    
    if (searchResult.playlists?.items?.length > 0) {
      const playlist = searchResult.playlists.items[0];
      await this.spotifyAPI(`/me/player/play${deviceParam}`, 'PUT', {
        context_uri: playlist.uri
      });
      return { 
        success: true, 
        message: `Playing ${mood} music: "${playlist.name}"`
      };
    }
    
    // Fallback to track search if no playlist found
    searchResult = await this.spotifyAPI(`/search?q=${encodeURIComponent(searchQuery)}&type=track&limit=20&market=US`);
    
    if (!searchResult.tracks?.items?.length) {
      return { success: false, message: 'No music found for this mood' };
    }
    
    const trackUris = searchResult.tracks.items.map(t => t.uri);
    const firstTrack = searchResult.tracks.items[0];
    
    await this.spotifyAPI(`/me/player/play${deviceParam}`, 'PUT', {
      uris: trackUris
    });
    
    return { 
      success: true, 
      message: `Playing ${mood} music: "${firstTrack.name}" by ${firstTrack.artists[0].name}`
    };
  }
}

// ================== AGENT: CONVERSATION (A2A Enabled) ==================
class ConversationAgent {
  constructor(bus) {
    this.bus = bus;
    this.name = 'CONVERSATION_AGENT';
    this.conversationHistory = new Map();
    
    // A2A Agent Card
    this.agentCard = new AgentCard({
      name: 'ConversationAgent',
      description: 'Processes natural language to detect user intent using GPT-4o function calling',
      version: '2.0.0',
      capabilities: {
        streaming: false,
        pushNotifications: false
      },
      skills: [
        {
          id: 'parse_intent',
          name: 'Parse Intent',
          description: 'Analyze user speech and detect music control intent',
          inputModes: ['text'],
          outputModes: ['text'],
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'User transcribed speech' },
              sessionId: { type: 'string' }
            },
            required: ['text', 'sessionId']
          }
        },
        {
          id: 'generate_response',
          name: 'Generate Response',
          description: 'Generate a conversational response for chat messages',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              sessionId: { type: 'string' }
            }
          }
        }
      ],
      defaultInputModes: ['text'],
      defaultOutputModes: ['text']
    });
    
    // Register with A2A Protocol
    if (a2aProtocol) {
      a2aProtocol.registerAgent('conversation', this.agentCard, {
        'parse_intent': (input, sessionId) => this.parseIntentA2A(input.text, sessionId),
        'generate_response': (input, sessionId) => this.generateChatResponse(sessionId, input.text)
      });
    }
    
    bus.subscribe('speech:transcribed', (data) => this.handleTranscript(data));
    bus.subscribe('spotify:result', (data) => this.handleSpotifyResult(data));
    
    log('AGENT', this.name, 'Initialized with A2A support');
  }
  
  // A2A Task Handler
  async parseIntentA2A(text, sessionId) {
    const history = this.getHistory(sessionId);
    history.push({ role: 'user', content: text });
    return await this.detectIntent(text, history);
  }
  
  getHistory(sessionId) {
    if (!this.conversationHistory.has(sessionId)) {
      this.conversationHistory.set(sessionId, []);
    }
    return this.conversationHistory.get(sessionId);
  }
  
  async handleTranscript(data) {
    const { sessionId, text } = data;
    
    // Filter out garbage/noise transcriptions
    const cleanText = text.trim().toLowerCase();
    const noisePatterns = [
      /^(uh|um|hmm|ah|oh|psst|shh|tsk)+\.?$/i,
      /^\.+$/,  // Just dots
      /^[^a-zA-Z]*$/,  // No letters at all
      /^(bye[.-]?)+$/i,  // Repeated bye (echo)
    ];
    
    if (cleanText.length < 2 || noisePatterns.some(p => p.test(cleanText))) {
      log('AGENT', this.name, `Ignoring noise/garbage: "${text}"`);
      return;
    }
    
    // Debounce rapid inputs
    if (responseManager.shouldDebounce(sessionId, 1500)) {
      log('AGENT', this.name, 'Debouncing rapid input');
      return;
    }
    
    log('AGENT', this.name, `Processing: "${text}"`);
    
    // Lock responses while processing
    responseManager.lock(sessionId);
    
    const history = this.getHistory(sessionId);
    history.push({ role: 'user', content: text });
    
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }
    
    try {
      // Use OpenAI Function Calling for more reliable intent detection
      const tools = [
        {
          type: 'function',
          function: {
            name: 'play_specific_music',
            description: 'Play a specific song, artist, album, or playlist. Use when user mentions a specific song name, artist name, band, or says things like "play X", "put on X", "I want to hear X"',
            parameters: {
              type: 'object',
              properties: {
                query: { 
                  type: 'string', 
                  description: 'The song name, artist name, or search query to play' 
                }
              },
              required: ['query']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'play_by_mood',
            description: 'Play music based on mood/feeling. Use when user says "play something happy/sad/calm/energetic" or describes a feeling/vibe without a specific song',
            parameters: {
              type: 'object',
              properties: {
                mood: { 
                  type: 'string', 
                  enum: ['happy', 'sad', 'energetic', 'calm', 'angry', 'romantic', 'focused', 'party', 'chill', 'workout'],
                  description: 'The mood or vibe of music to play' 
                }
              },
              required: ['mood']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'skip_to_next',
            description: 'Skip to next song. Use for: next, skip, next song, different song, another song, change the song, play something else, I dont like this, switch, forward',
            parameters: { type: 'object', properties: {} }
          }
        },
        {
          type: 'function',
          function: {
            name: 'go_to_previous',
            description: 'Go back to previous song. Use for: previous, back, go back, last song, before, previous song',
            parameters: { type: 'object', properties: {} }
          }
        },
        {
          type: 'function',
          function: {
            name: 'pause_music',
            description: 'Pause/stop the music. Use for: pause, stop, hold, wait, quiet, silence, shut up, mute',
            parameters: { type: 'object', properties: {} }
          }
        },
        {
          type: 'function',
          function: {
            name: 'resume_music',
            description: 'Resume/unpause music that was paused. Only use when NO specific song is mentioned. Use for: resume, continue, unpause, start again, play (without song name)',
            parameters: { type: 'object', properties: {} }
          }
        },
        {
          type: 'function',
          function: {
            name: 'adjust_volume',
            description: 'Change the volume level',
            parameters: {
              type: 'object',
              properties: {
                direction: { 
                  type: 'string', 
                  enum: ['up', 'down'],
                  description: 'Increase or decrease volume' 
                },
                level: { 
                  type: 'number', 
                  description: 'Specific volume level 0-100 if mentioned' 
                }
              }
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'get_current_track',
            description: 'Get info about currently playing song. Use for: whats playing, what is this, current song, who sings this, what song is this',
            parameters: { type: 'object', properties: {} }
          }
        },
        {
          type: 'function',
          function: {
            name: 'general_chat',
            description: 'For general conversation, greetings, questions, or when no music command is detected',
            parameters: {
              type: 'object',
              properties: {
                message: { type: 'string', description: 'The user message' }
              }
            }
          }
        }
      ];

      const response = await openai.chat.completions.create({
        model: MODELS.INTENT_DETECTION,
        messages: [
          {
            role: 'system',
            content: `You are a voice assistant for music control. Listen carefully to what the user wants.

CRITICAL RULES:
1. If user says "play a song" or just "play" WITHOUT a specific name → resume_music (they want to continue)
2. If user says "play [something specific]" → play_specific_music with that query
3. "Another song", "different song", "next", "skip" → skip_to_next
4. "Play something [mood]" without artist/song → play_by_mood
5. Greetings like "hi", "hello", "bye" → general_chat

Be flexible with accents and unclear speech. Try to understand the intent even if words are slightly wrong.`
          },
          ...history.slice(-3)
        ],
        tools,
        tool_choice: 'required',
        temperature: 0.1
      });
      
      // Parse function call result
      const toolCall = response.choices[0].message.tool_calls?.[0];
      let intent;
      
      if (toolCall) {
        const funcName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments || '{}');
        
        // Map function names to intents
        const funcToIntent = {
          'play_specific_music': { intent: 'play_music', query: args.query },
          'play_by_mood': { intent: 'play_mood', mood: args.mood },
          'skip_to_next': { intent: 'next' },
          'go_to_previous': { intent: 'previous' },
          'pause_music': { intent: 'pause' },
          'resume_music': { intent: 'resume' },
          'adjust_volume': { intent: 'volume', volume_level: args.level, volume_direction: args.direction },
          'get_current_track': { intent: 'current_track' },
          'general_chat': { intent: 'chat' }
        };
        
        intent = { ...funcToIntent[funcName], confidence: 0.95 };
        log('AGENT', this.name, `Function called: ${funcName}`, args);
      } else {
        intent = { intent: 'chat', confidence: 0.5 };
      }
      
      log('AGENT', this.name, 'Intent detected', intent);
      
      await this.routeIntent(sessionId, intent, text);
      
    } catch (error) {
      log('ERROR', this.name, 'Intent parsing failed', error.message);
      this.bus.publish('response:ready', {
        sessionId,
        text: "I didn't quite catch that. Could you try again?",
        type: 'error'
      });
      responseManager.unlock(sessionId);
    }
  }
  
  async routeIntent(sessionId, intent, originalText) {
    const { intent: action, confidence } = intent;
    
    log('AGENT', this.name, `Routing: ${action} (confidence: ${confidence})`);
    
    switch (action) {
      case 'play_music':
        this.bus.publish('spotify:command', {
          sessionId,
          command: 'play_music',
          args: { query: intent.query }
        });
        break;
        
      case 'pause':
        this.bus.publish('spotify:command', {
          sessionId,
          command: 'pause',
          args: {}
        });
        break;
        
      case 'resume':
        this.bus.publish('spotify:command', {
          sessionId,
          command: 'resume',
          args: {}
        });
        break;
        
      case 'next':
        this.bus.publish('spotify:command', {
          sessionId,
          command: 'next',
          args: {}
        });
        break;
        
      case 'previous':
        this.bus.publish('spotify:command', {
          sessionId,
          command: 'previous',
          args: {}
        });
        break;
        
      case 'volume':
        let level = intent.volume_level;
        if (intent.volume_direction === 'up') level = 80;
        if (intent.volume_direction === 'down') level = 30;
        this.bus.publish('spotify:command', {
          sessionId,
          command: 'volume',
          args: { level: level || 50 }
        });
        break;
        
      case 'current_track':
        this.bus.publish('spotify:command', {
          sessionId,
          command: 'current_track',
          args: {}
        });
        break;
        
      case 'play_mood':
        this.bus.publish('spotify:command', {
          sessionId,
          command: 'play_mood',
          args: { mood: intent.mood }
        });
        break;
        
      case 'chat':
      default:
        this.bus.publish('sentiment:analyze', { sessionId, text: originalText });
        await this.generateChatResponse(sessionId, originalText);
        break;
    }
  }
  
  async generateChatResponse(sessionId, text) {
    const history = this.getHistory(sessionId);
    
    const response = await openai.chat.completions.create({
      model: MODELS.CHAT_RESPONSE,
      messages: [
        {
          role: 'system',
          content: `You are Music Buddy, a friendly voice assistant for music control. 
Keep responses SHORT (1-2 sentences max) since they will be spoken aloud.
You can suggest music based on mood or help with playback.
If the user seems to want music but wasn't clear, ask what they'd like to hear.`
        },
        ...history.slice(-5)
      ],
      temperature: 0.7,
      max_tokens: 100
    });
    
    const reply = response.choices[0].message.content;
    history.push({ role: 'assistant', content: reply });
    
    this.bus.publish('response:ready', {
      sessionId,
      text: reply,
      type: 'chat'
    });
    
    // Unlock after sending chat response
    responseManager.unlock(sessionId);
  }
  
  handleSpotifyResult(data) {
    const { sessionId, result } = data;
    const history = this.getHistory(sessionId);
    
    history.push({ role: 'assistant', content: result.message });
    
    this.bus.publish('response:ready', {
      sessionId,
      text: result.message,
      type: 'spotify_response',
      data: result
    });
    
    // Unlock after Spotify response
    responseManager.unlock(sessionId);
  }
}

// ================== AGENT: SENTIMENT (A2A Enabled) ==================
class SentimentAgent {
  constructor(bus) {
    this.bus = bus;
    this.name = 'SENTIMENT_AGENT';
    this.userMoods = new Map();
    
    // A2A Agent Card
    this.agentCard = new AgentCard({
      name: 'SentimentAgent',
      description: 'Analyzes emotional tone and mood from user messages for music recommendations',
      version: '2.0.0',
      capabilities: {
        streaming: false,
        pushNotifications: false
      },
      skills: [
        {
          id: 'analyze_sentiment',
          name: 'Analyze Sentiment',
          description: 'Analyzes text for emotional tone, mood, and intensity',
          inputModes: ['text'],
          outputModes: ['text'],
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Text to analyze' }
            },
            required: ['text']
          }
        },
        {
          id: 'get_mood_history',
          name: 'Get Mood History',
          description: 'Returns recent mood history for a session',
          parameters: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' }
            }
          }
        }
      ],
      defaultInputModes: ['text'],
      defaultOutputModes: ['text']
    });
    
    // Register with A2A Protocol
    if (a2aProtocol) {
      a2aProtocol.registerAgent('sentiment', this.agentCard, {
        'analyze_sentiment': (input, sessionId) => this.analyzeSentimentA2A(input, sessionId),
        'get_mood_history': (input, sessionId) => this.getMoodHistory(sessionId)
      });
    }
    
    bus.subscribe('sentiment:analyze', (data) => this.analyzeSentiment(data));
    
    log('AGENT', this.name, 'Initialized with A2A support');
  }
  
  // A2A Task Handler
  async analyzeSentimentA2A(input, sessionId) {
    const result = await this.performSentimentAnalysis(input.text);
    this.storeMood(sessionId, result);
    return result;
  }
  
  getMoodHistory(sessionId) {
    return this.userMoods.get(sessionId) || [];
  }
  
  storeMood(sessionId, sentiment) {
    if (!this.userMoods.has(sessionId)) {
      this.userMoods.set(sessionId, []);
    }
    this.userMoods.get(sessionId).push({
      ...sentiment,
      timestamp: Date.now()
    });
  }
  
  async performSentimentAnalysis(text) {
    const response = await openai.chat.completions.create({
      model: MODELS.SENTIMENT_ANALYSIS,  // Using GPT-4o for better accuracy
      messages: [
        {
          role: 'system',
          content: `You are an expert emotion and sentiment analyzer. Analyze the user's message for emotional content.

Consider:
- Primary emotion/mood
- Emotional intensity (0.0 = very weak, 1.0 = very strong)
- Whether the emotional state suggests they might want music
- Secondary emotions if present
- Energy level (low, medium, high)

Return JSON:
{
  "mood": "happy" | "sad" | "energetic" | "calm" | "angry" | "neutral" | "excited" | "tired" | "anxious" | "romantic" | "nostalgic" | "focused",
  "intensity": 0.0-1.0,
  "energy_level": "low" | "medium" | "high",
  "secondary_mood": "string or null",
  "suggest_music": true | false,
  "music_recommendation": "optional genre/mood suggestion if suggest_music is true",
  "confidence": 0.0-1.0
}`
        },
        { role: 'user', content: text }
      ],
      temperature: 0.2,  // Lower temperature for more consistent analysis
      response_format: { type: 'json_object' }
    });
    
    return JSON.parse(response.choices[0].message.content);
  }
  
  async analyzeSentiment(data) {
    const { sessionId, text } = data;
    
    try {
      const sentiment = await this.performSentimentAnalysis(text);
      log('AGENT', this.name, 'Sentiment', sentiment);
      
      this.storeMood(sessionId, sentiment);
      
      // Suggest music if strong emotion detected
      if (sentiment.suggest_music && sentiment.intensity > 0.6) {
        this.bus.publish('sentiment:suggestion', {
          sessionId,
          mood: sentiment.mood,
          energy: sentiment.energy_level,
          recommendation: sentiment.music_recommendation
        });
      }
      
    } catch (error) {
      log('ERROR', this.name, 'Sentiment analysis failed', error.message);
    }
  }
}

// ================== AGENT: SPEECH (A2A Enabled) ==================
class SpeechAgent {
  constructor(bus) {
    this.bus = bus;
    this.name = 'SPEECH_AGENT';
    this.audioBuffers = new Map();
    this.silenceTimers = new Map();
    this.isProcessing = new Map();
    this.isSpeaking = new Map(); // Track if user is currently speaking
    this.lastAudioLevel = new Map();
    
    // A2A Agent Card
    this.agentCard = new AgentCard({
      name: 'SpeechAgent',
      description: 'Handles speech-to-text (Whisper) and text-to-speech (OpenAI TTS) operations',
      version: '2.0.0',
      capabilities: {
        streaming: true,
        pushNotifications: false
      },
      skills: [
        {
          id: 'transcribe_audio',
          name: 'Transcribe Audio',
          description: 'Convert audio to text using OpenAI Whisper',
          inputModes: ['audio'],
          outputModes: ['text'],
          parameters: {
            type: 'object',
            properties: {
              audioData: { type: 'string', description: 'Base64 encoded audio data' }
            },
            required: ['audioData']
          }
        },
        {
          id: 'generate_speech',
          name: 'Generate Speech',
          description: 'Convert text to speech using OpenAI TTS',
          inputModes: ['text'],
          outputModes: ['audio'],
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Text to convert to speech' }
            },
            required: ['text']
          }
        }
      ],
      defaultInputModes: ['audio', 'text'],
      defaultOutputModes: ['text', 'audio']
    });
    
    // Register with A2A Protocol
    if (a2aProtocol) {
      a2aProtocol.registerAgent('speech', this.agentCard, {
        'transcribe_audio': (input) => this.transcribeAudioA2A(input.audioData),
        'generate_speech': (input, sessionId) => this.generateSpeechA2A(input.text, sessionId)
      });
    }
    
    bus.subscribe('audio:received', (data) => this.handleAudio(data));
    bus.subscribe('audio:process_now', (data) => this.processAudioNow(data));
    bus.subscribe('response:ready', (data) => this.generateSpeech(data));
    
    log('AGENT', this.name, 'Initialized with A2A support');
  }
  
  // A2A Task Handlers
  async transcribeAudioA2A(audioData) {
    const buffer = Buffer.from(audioData, 'base64');
    return await this.transcribeBuffer(buffer);
  }
  
  async generateSpeechA2A(text, sessionId) {
    return await this.performTTS(text, sessionId);
  }
  
  // Calculate RMS (Root Mean Square) audio level from PCM data
  calculateAudioLevel(buffer) {
    const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length) / 32768; // Normalize to 0-1
  }
  
  handleAudio(data) {
    const { sessionId, audioData } = data;
    const buffer = Buffer.from(audioData);
    
    // Calculate audio level for VAD
    const audioLevel = this.calculateAudioLevel(buffer);
    const SPEECH_THRESHOLD = 0.02; // Adjust this threshold as needed
    const SILENCE_DURATION = 1500; // 1.5 seconds of silence to trigger processing
    const NO_AUDIO_TIMEOUT = 500; // Process if no audio received for 500ms (echo suppression case)
    
    if (!this.audioBuffers.has(sessionId)) {
      this.audioBuffers.set(sessionId, []);
      this.isSpeaking.set(sessionId, false);
    }
    
    // Clear the "no audio" timeout since we received audio
    if (this.noAudioTimers && this.noAudioTimers.has(sessionId)) {
      clearTimeout(this.noAudioTimers.get(sessionId));
      this.noAudioTimers.delete(sessionId);
    }
    
    // Start "no audio" timeout - if user was speaking and audio stops arriving
    // (e.g., due to echo suppression), process what we have
    if (this.isSpeaking.get(sessionId)) {
      if (!this.noAudioTimers) this.noAudioTimers = new Map();
      this.noAudioTimers.set(sessionId, setTimeout(() => {
        if (this.isSpeaking.get(sessionId) && (this.audioBuffers.get(sessionId)?.length || 0) > 0) {
          log('AGENT', this.name, '⏱️ No audio received timeout - processing captured speech');
          this.isSpeaking.set(sessionId, false);
          if (this.silenceTimers.has(sessionId)) {
            clearTimeout(this.silenceTimers.get(sessionId));
            this.silenceTimers.delete(sessionId);
          }
          this.processAudio(sessionId);
        }
      }, NO_AUDIO_TIMEOUT));
    }
    
    // Voice Activity Detection
    if (audioLevel > SPEECH_THRESHOLD) {
      // User is speaking
      if (!this.isSpeaking.get(sessionId)) {
        log('AGENT', this.name, '🎤 Speech detected');
        this.isSpeaking.set(sessionId, true);
        this.bus.publish('client:listening_state', { sessionId, state: 'listening' });
      }
      this.audioBuffers.get(sessionId).push(buffer);
      
      // Clear silence timer since user is speaking
      if (this.silenceTimers.has(sessionId)) {
        clearTimeout(this.silenceTimers.get(sessionId));
        this.silenceTimers.delete(sessionId);
      }
    } else if (this.isSpeaking.get(sessionId)) {
      // User was speaking but now silent - start silence timer
      this.audioBuffers.get(sessionId).push(buffer); // Include trailing silence
      
      if (!this.silenceTimers.has(sessionId)) {
        this.silenceTimers.set(sessionId, setTimeout(() => {
          log('AGENT', this.name, '🔇 Silence detected, processing...');
          this.isSpeaking.set(sessionId, false);
          this.silenceTimers.delete(sessionId);
          this.processAudio(sessionId);
        }, SILENCE_DURATION));
      }
    }
    // If not speaking and audio level is low, just ignore (ambient noise)
  }
  
  async processAudioNow(data) {
    const { sessionId } = data;
    
    // Clear any pending timer
    if (this.silenceTimers.has(sessionId)) {
      clearTimeout(this.silenceTimers.get(sessionId));
      this.silenceTimers.delete(sessionId);
    }
    
    await this.processAudio(sessionId);
  }
  
  async processAudio(sessionId) {
    if (this.isProcessing.get(sessionId)) return;
    this.isProcessing.set(sessionId, true);
    
    const chunks = this.audioBuffers.get(sessionId) || [];
    if (chunks.length === 0) {
      this.isProcessing.set(sessionId, false);
      return;
    }
    
    this.audioBuffers.set(sessionId, []);
    
    try {
      const audioBuffer = Buffer.concat(chunks);
      
      if (audioBuffer.length < 3200) {
        this.isProcessing.set(sessionId, false);
        return;
      }
      
      log('AGENT', this.name, `Processing ${audioBuffer.length} bytes of audio`);
      
      // Notify client that we're processing
      this.bus.publish('client:listening_state', { sessionId, state: 'processing' });
      
      const wavBuffer = this.pcmToWav(audioBuffer);
      
      try {
        const transcription = await this.transcribe(wavBuffer);
      
        if (transcription && transcription.trim()) {
          log('AGENT', this.name, `Transcribed: "${transcription}"`);
          
          this.bus.publish('speech:transcribed', {
            sessionId,
            text: transcription
          });
          
          this.bus.publish('client:transcript', {
            sessionId,
            text: transcription,
            role: 'user'
          });
        } else {
          log('AGENT', this.name, 'No speech detected in audio');
          this.bus.publish('client:listening_state', { sessionId, state: 'ready' });
        }
      } catch (transcribeError) {
        log('ERROR', this.name, 'Whisper transcription error:', transcribeError.message);
        this.bus.publish('client:listening_state', { sessionId, state: 'ready' });
      }
      
    } catch (error) {
      log('ERROR', this.name, 'Processing failed', error.message);
      this.bus.publish('client:listening_state', { sessionId, state: 'ready' });
    }
    
    this.isProcessing.set(sessionId, false);
  }
  
  pcmToWav(pcmBuffer) {
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcmBuffer.length;
    const headerSize = 44;
    
    const wavBuffer = Buffer.alloc(headerSize + dataSize);
    
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + dataSize, 4);
    wavBuffer.write('WAVE', 8);
    
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16);
    wavBuffer.writeUInt16LE(1, 20);
    wavBuffer.writeUInt16LE(numChannels, 22);
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(byteRate, 28);
    wavBuffer.writeUInt16LE(blockAlign, 32);
    wavBuffer.writeUInt16LE(bitsPerSample, 34);
    
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(dataSize, 40);
    pcmBuffer.copy(wavBuffer, 44);
    
    return wavBuffer;
  }
  
  async transcribe(wavBuffer) {
    // Use OpenAI's toFile helper for Node.js
    const file = await toFile(wavBuffer, 'audio.wav', { type: 'audio/wav' });
    
    const response = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: file,
      language: 'en',
      response_format: 'text'
    });
    
    return response;
  }
  
  async generateSpeech(data) {
    const { sessionId, text, type } = data;
    
    if (!text) return;
    
    // Prevent duplicate TTS for same session
    if (this.isSpeaking.get(`tts_${sessionId}`)) {
      log('AGENT', this.name, 'TTS already in progress, skipping');
      return;
    }
    this.isSpeaking.set(`tts_${sessionId}`, true);
    
    // Pause audio input to prevent echo (assistant hearing itself)
    this.bus.publish('client:echo_suppress', { sessionId, suppress: true });
    
    log('AGENT', this.name, `Generating speech: "${text.substring(0, 50)}..."`);
    
    try {
      const response = await openai.audio.speech.create({
        model: MODELS.TTS_MODEL,
        voice: MODELS.TTS_VOICE,
        input: text,
        response_format: 'mp3'
      });
      
      const arrayBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');
      
      this.bus.publish('client:audio', {
        sessionId,
        audio: base64Audio
      });
      
      this.bus.publish('client:transcript', {
        sessionId,
        text,
        role: 'assistant'
      });
      
      // Estimate audio duration (rough: 150 words per minute, average word is 5 chars)
      // Add extra buffer time to prevent echo
      const estimatedDuration = Math.max(3500, (text.length / 5) * (60000 / 150) + 1500);
      
      // Wait for audio to finish playing before resuming listening
      setTimeout(() => {
        this.bus.publish('client:echo_suppress', { sessionId, suppress: false });
        this.bus.publish('client:listening_state', { sessionId, state: 'ready' });
        this.isSpeaking.set(`tts_${sessionId}`, false);
      }, estimatedDuration);
      
    } catch (error) {
      log('ERROR', this.name, 'TTS failed', error.message);
      this.bus.publish('client:echo_suppress', { sessionId, suppress: false });
      this.isSpeaking.set(`tts_${sessionId}`, false);
      this.bus.publish('client:listening_state', { sessionId, state: 'ready' });
    }
  }
}

// ================== AGENT: ORCHESTRATOR (A2A Enabled) ==================
class OrchestratorAgent {
  constructor(bus) {
    this.bus = bus;
    this.name = 'ORCHESTRATOR';
    this.sessions = new Map();
    
    // A2A Agent Card for Orchestrator
    this.agentCard = new AgentCard({
      name: 'OrchestratorAgent',
      description: 'Coordinates all agents and manages user sessions in the Music Buddy system',
      version: '2.0.0',
      capabilities: {
        streaming: true,
        pushNotifications: true
      },
      skills: [
        {
          id: 'coordinate_agents',
          name: 'Coordinate Agents',
          description: 'Routes messages between agents and manages workflow'
        },
        {
          id: 'manage_sessions',
          name: 'Manage Sessions',
          description: 'Creates and manages user sessions'
        },
        {
          id: 'list_agents',
          name: 'List Agents',
          description: 'Returns list of all registered agents and their capabilities'
        }
      ]
    });
    
    // Register with A2A Protocol
    if (a2aProtocol) {
      a2aProtocol.registerAgent('orchestrator', this.agentCard, {
        'list_agents': () => a2aProtocol.listAgents(),
        'manage_sessions': (input) => this.getSessionInfo(input.sessionId)
      });
    }
    
    // Initialize all agents
    this.spotifyAgent = new SpotifyAgent(bus);
    this.conversationAgent = new ConversationAgent(bus);
    this.sentimentAgent = new SentimentAgent(bus);
    this.speechAgent = new SpeechAgent(bus);
    
    log('AGENT', this.name, 'All agents initialized with A2A Protocol');
  }
  
  registerSession(sessionId, ws) {
    this.sessions.set(sessionId, { ws, startTime: Date.now() });
    log('AGENT', this.name, `Session registered: ${sessionId}`);
  }
  
  removeSession(sessionId) {
    this.sessions.delete(sessionId);
    log('AGENT', this.name, `Session removed: ${sessionId}`);
  }
  
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
  
  getSessionInfo(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      sessionId,
      startTime: session.startTime,
      duration: Date.now() - session.startTime
    };
  }
}

// ================== INITIALIZE A2A PROTOCOL ==================
a2aProtocol = new A2AProtocolHandler(messageBus);

// ================== INITIALIZE ORCHESTRATOR ==================
const orchestrator = new OrchestratorAgent(messageBus);

// ================== WEBSOCKET HANDLING ==================
wss.on('connection', (ws) => {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  orchestrator.registerSession(sessionId, ws);
  
  log('INFO', 'SERVER', `New connection: ${sessionId}`);
  
  ws.send(JSON.stringify({ type: 'connected', sessionId }));
  
  ws.on('message', (data) => {
    // Check if it's a JSON string (text message)
    const isString = typeof data === 'string';
    const isJsonBuffer = data instanceof Buffer && data[0] === 123; // 123 = '{'
    
    if (isString || isJsonBuffer) {
      try {
        const msg = JSON.parse(isString ? data : data.toString());
        if (msg.type === 'device_id') {
          webPlaybackDeviceId = msg.deviceId;
          log('INFO', 'SERVER', `Web Playback Device ID: ${webPlaybackDeviceId}`);
        } else if (msg.type === 'stop_listening') {
          log('INFO', 'SERVER', '🛑 User stopped listening, processing audio...');
          messageBus.publish('audio:process_now', { sessionId });
        }
        return;
      } catch (e) {
        // Not JSON, treat as audio
      }
    }
    
    // Binary audio data
    if (data instanceof Buffer) {
      messageBus.publish('audio:received', { sessionId, audioData: data });
    }
  });
  
  ws.on('close', () => {
    orchestrator.removeSession(sessionId);
    log('INFO', 'SERVER', `Connection closed: ${sessionId}`);
  });
  
  // Subscribe to events for this session
  const sendToClient = (event, handler) => {
    messageBus.subscribe(event, (data) => {
      if (data.sessionId === sessionId && ws.readyState === WebSocket.OPEN) {
        handler(data);
      }
    });
  };
  
  sendToClient('client:transcript', (data) => {
    ws.send(JSON.stringify({
      type: 'transcript',
      role: data.role,
      text: data.text
    }));
  });
  
  sendToClient('client:audio', (data) => {
    ws.send(JSON.stringify({
      type: 'audio_mp3',
      data: data.audio
    }));
  });
  
  sendToClient('client:listening_state', (data) => {
    ws.send(JSON.stringify({
      type: 'listening_state',
      state: data.state
    }));
  });
  
  sendToClient('client:echo_suppress', (data) => {
    ws.send(JSON.stringify({
      type: 'echo_suppress',
      suppress: data.suppress
    }));
  });
});

// ================== REST API ==================
app.get('/api/spotify-token', async (req, res) => {
  try {
    const token = await getValidToken();
    res.json({ accessToken: token, token: token }); // Support both field names
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/set-device', (req, res) => {
  webPlaybackDeviceId = req.body.deviceId;
  log('INFO', 'SERVER', `Web Playback Device ID: ${webPlaybackDeviceId}`);
  res.json({ success: true });
});

// ================== A2A PROTOCOL API ==================
// A2A Agent Discovery endpoint
app.get('/.well-known/agent.json', (req, res) => {
  const response = orchestrator.agentCard.toJSON();
  logA2A('DISCOVERY REQUEST', { endpoint: '/.well-known/agent.json', method: 'GET' });
  logA2A('DISCOVERY RESPONSE', response);
  res.json(response);
});

// List all registered agents
app.get('/api/a2a/agents', (req, res) => {
  logA2A('AGENTS LIST REQUEST', { endpoint: '/api/a2a/agents', method: 'GET' });
  const agents = a2aProtocol.listAgents();
  const response = { jsonrpc: '2.0', result: { agents } };
  logA2A('AGENTS LIST RESPONSE', response);
  res.json(response);
});

// Get specific agent card
app.get('/api/a2a/agents/:agentId', (req, res) => {
  logA2A('AGENT CARD REQUEST', { endpoint: `/api/a2a/agents/${req.params.agentId}`, method: 'GET', agentId: req.params.agentId });
  const card = a2aProtocol.getAgentCard(req.params.agentId);
  if (!card) {
    const errorResponse = A2AMessage.createError(null, -32001, 'Agent not found');
    logA2A('AGENT CARD ERROR', errorResponse);
    return res.status(404).json(errorResponse);
  }
  const response = A2AMessage.createResponse(null, card);
  logA2A('AGENT CARD RESPONSE', response);
  res.json(response);
});

// Send task to agent (A2A tasks/send)
app.post('/api/a2a/tasks/send', async (req, res) => {
  try {
    const { skillId, input, sessionId } = req.body;
    logA2A('TASK SEND REQUEST', { endpoint: '/api/a2a/tasks/send', method: 'POST', body: req.body });
    
    if (!skillId) {
      const errorResponse = A2AMessage.createError(req.body.id, -32602, 'Missing skillId');
      logA2A('TASK SEND ERROR', errorResponse);
      return res.status(400).json(errorResponse);
    }
    
    const task = await a2aProtocol.sendTask(skillId, input || {}, sessionId || 'api');
    const response = A2AMessage.createResponse(req.body.id, task.toJSON());
    logA2A('TASK SEND RESPONSE', response);
    res.json(response);
  } catch (error) {
    const errorResponse = A2AMessage.createError(req.body.id, -32603, error.message);
    logA2A('TASK SEND ERROR', errorResponse);
    res.status(500).json(errorResponse);
  }
});

// Get task status
app.get('/api/a2a/tasks/:taskId', (req, res) => {
  logA2A('TASK STATUS REQUEST', { endpoint: `/api/a2a/tasks/${req.params.taskId}`, method: 'GET', taskId: req.params.taskId });
  const task = a2aProtocol.getTask(req.params.taskId);
  if (!task) {
    const errorResponse = A2AMessage.createError(null, -32001, 'Task not found');
    logA2A('TASK STATUS ERROR', errorResponse);
    return res.status(404).json(errorResponse);
  }
  const response = A2AMessage.createResponse(null, task);
  logA2A('TASK STATUS RESPONSE', response);
  res.json(response);
});

// A2A JSON-RPC endpoint (full protocol compliance)
app.post('/api/a2a/rpc', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;
  logA2A('JSON-RPC REQUEST', { endpoint: '/api/a2a/rpc', body: req.body });
  
  if (jsonrpc !== '2.0') {
    const errorResponse = A2AMessage.createError(id, -32600, 'Invalid JSON-RPC version');
    logA2A('JSON-RPC ERROR', errorResponse);
    return res.status(400).json(errorResponse);
  }
  
  try {
    let result;
    
    switch (method) {
      case 'tasks/send':
        const task = await a2aProtocol.sendTask(params.skillId, params.input, params.sessionId);
        result = task.toJSON();
        break;
        
      case 'tasks/get':
        result = a2aProtocol.getTask(params.taskId);
        if (!result) throw new Error('Task not found');
        break;
        
      case 'agents/list':
        result = { agents: a2aProtocol.listAgents() };
        break;
        
      case 'agents/get':
        result = a2aProtocol.getAgentCard(params.agentId);
        if (!result) throw new Error('Agent not found');
        break;
        
      default:
        const methodError = A2AMessage.createError(id, -32601, `Method not found: ${method}`);
        logA2A('JSON-RPC ERROR', methodError);
        return res.status(400).json(methodError);
    }
    
    const response = A2AMessage.createResponse(id, result);
    logA2A('JSON-RPC RESPONSE', response);
    res.json(response);
  } catch (error) {
    const errorResponse = A2AMessage.createError(id, -32603, error.message);
    logA2A('JSON-RPC ERROR', errorResponse);
    res.status(500).json(errorResponse);
  }
});

// ================== SERVER START ==================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║       🎵 MUSIC BUDDY - MULTI-AGENT ARCHITECTURE + A2A PROTOCOL 🎵 ║
╠════════════════════════════════════════════════════════════════════╣
║  A2A Protocol: Google Agent-to-Agent Communication                 ║
║  JSON-RPC 2.0 compliant with Agent Cards & Task Management        ║
╠════════════════════════════════════════════════════════════════════╣
║  Agents:                                                           ║
║  • Orchestrator - Coordinates all agents (A2A enabled)             ║
║  • Speech - Whisper STT + OpenAI TTS-HD                           ║
║  • Conversation - ${MODELS.INTENT_DETECTION} intent parsing (Function Calling)        ║
║  • Sentiment - ${MODELS.SENTIMENT_ANALYSIS} mood analysis                       ║
║  • Spotify - Music playback control                                ║
╠════════════════════════════════════════════════════════════════════╣
║  A2A Endpoints:                                                    ║
║  • GET  /.well-known/agent.json - Agent discovery                  ║
║  • GET  /api/a2a/agents - List all agents                          ║
║  • POST /api/a2a/tasks/send - Send task to agent                   ║
║  • POST /api/a2a/rpc - JSON-RPC 2.0 endpoint                       ║
╠════════════════════════════════════════════════════════════════════╣
║  🌐 http://localhost:${PORT}                                          ║
╚════════════════════════════════════════════════════════════════════╝
  `);
});