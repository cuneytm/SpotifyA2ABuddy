# 🎵 Music Buddy - Voice-Enabled AI Music Companion

A sophisticated voice-enabled AI music companion with Spotify integration, featuring a **Multi-Agent Architecture** implementing **Google's A2A (Agent-to-Agent) Protocol** for structured inter-agent communication.

## 🏗️ Architecture Overview

```mermaid
flowchart TB
    subgraph USER["🎤 User Input Layer"]
        MIC["Microphone\nBrowser API"] --> VAD["VAD (Voice Activity Detection)\nSPEECH_THRESHOLD: 0.02, SILENCE: 1500ms"]
    end

    subgraph SERVER["🖥️ Node.js Server + A2A Protocol"]
        BUS["📨 MessageBus\nEvent Pub/Sub"] <--> A2A["🔗 A2A Protocol Handler\nJSON-RPC 2.0 Compliant\nAgent Cards & Task Management"]
    end

    subgraph AGENTS["🤖 Multi-Agent System (A2A Enabled)"]
        ORCH["🎯 Orchestrator\ncoordinate, manage"]
        SPEECH["🗣️ Speech\ntranscribe, gen_speech"]
        CONV["💬 Conversation\nparse_intent, gen_response"]
        SENT["😊 Sentiment\nanalyze, mood_history"]
        SPOT["🎵 Spotify\nplay, pause, skip, mood"]
    end

    subgraph EXTERNAL["🧠 External Services"]
        OPENAI["OpenAI APIs\n• GPT-4o\n• Whisper-1\n• Functions"]
        SPOTIFY["Spotify API\n• Search\n• Playback\n• Queue (20)"]
        TTS["TTS-1-HD\n• Voice: nova\n• HD Audio"]
    end

    USER -->|WebSocket| SERVER
    SERVER --> AGENTS
    AGENTS --> EXTERNAL
```

## 🔗 A2A (Agent-to-Agent) Protocol

This project implements [Google's A2A Protocol](https://github.com/google/A2A) for structured agent communication. The A2A protocol provides:

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Agent Card** | JSON document describing an agent's capabilities, skills, and metadata |
| **Skill** | A specific capability an agent can perform (e.g., `play_music`, `analyze_sentiment`) |
| **Task** | A unit of work with states: `submitted` → `working` → `completed`/`failed` |
| **JSON-RPC 2.0** | Communication protocol for request/response between agents |

### Agent Cards

Each agent registers itself with an **Agent Card** declaring its capabilities:

```javascript
// SpotifyAgent Agent Card
{
  "name": "SpotifyAgent",
  "description": "Controls Spotify playback and music recommendations",
  "version": "1.0.0",
  "url": "http://localhost:3000/api/a2a/agents/SpotifyAgent",
  "skills": [
    { "id": "play_music", "name": "Play Music", "description": "Play a specific song or artist" },
    { "id": "pause_music", "name": "Pause", "description": "Pause current playback" },
    { "id": "resume_music", "name": "Resume", "description": "Resume playback" },
    { "id": "skip_next", "name": "Next Track", "description": "Skip to next song" },
    { "id": "skip_previous", "name": "Previous Track", "description": "Go to previous song" },
    { "id": "set_volume", "name": "Set Volume", "description": "Adjust volume level" },
    { "id": "get_current_track", "name": "Current Track", "description": "Get now playing info" },
    { "id": "play_by_mood", "name": "Play by Mood", "description": "Play music matching mood" }
  ]
}
```

### A2A REST API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/agent.json` | GET | Agent discovery (returns Orchestrator card) |
| `/api/a2a/agents` | GET | List all registered agents |
| `/api/a2a/agents/:id` | GET | Get specific agent's card |
| `/api/a2a/tasks/send` | POST | Send a task to an agent |
| `/api/a2a/tasks/:id` | GET | Get task status |
| `/api/a2a/rpc` | POST | Full JSON-RPC 2.0 endpoint |

---

## 📦 A2A Packet Examples

### 1. Agent Discovery Request

```http
GET /.well-known/agent.json HTTP/1.1
Host: localhost:3000
```

**Response:**
```json
{
  "name": "OrchestratorAgent",
  "description": "Coordinates all agents and manages user sessions",
  "version": "1.0.0",
  "url": "http://localhost:3000",
  "skills": [
    { "id": "coordinate_agents", "name": "Coordinate", "description": "Route tasks between agents" },
    { "id": "manage_sessions", "name": "Sessions", "description": "Manage user sessions" },
    { "id": "list_agents", "name": "List Agents", "description": "List all available agents" }
  ]
}
```

### 2. List All Agents

```http
GET /api/a2a/agents HTTP/1.1
Host: localhost:3000
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "agents": [
      {
        "name": "OrchestratorAgent",
        "version": "1.0.0",
        "skills": ["coordinate_agents", "manage_sessions", "list_agents"]
      },
      {
        "name": "SpotifyAgent",
        "version": "1.0.0",
        "skills": ["play_music", "pause_music", "resume_music", "skip_next", "skip_previous", "set_volume", "get_current_track", "play_by_mood"]
      },
      {
        "name": "ConversationAgent",
        "version": "1.0.0",
        "skills": ["parse_intent", "generate_response"]
      },
      {
        "name": "SentimentAgent",
        "version": "1.0.0",
        "skills": ["analyze_sentiment", "get_mood_history"]
      },
      {
        "name": "SpeechAgent",
        "version": "1.0.0",
        "skills": ["transcribe_audio", "generate_speech"]
      }
    ]
  }
}
```

### 3. Send Task Request (REST)

```http
POST /api/a2a/tasks/send HTTP/1.1
Host: localhost:3000
Content-Type: application/json

{
  "skillId": "play_by_mood",
  "input": {
    "mood": "happy",
    "energy": "high"
  },
  "sessionId": "user-session-123"
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "task_a1b2c3d4e5f6",
    "skillId": "play_by_mood",
    "state": "completed",
    "input": {
      "mood": "happy",
      "energy": "high"
    },
    "output": {
      "success": true,
      "track": {
        "name": "Happy",
        "artist": "Pharrell Williams",
        "album": "G I R L"
      },
      "queuedTracks": 20
    },
    "createdAt": "2026-01-04T18:07:40.000Z",
    "updatedAt": "2026-01-04T18:07:41.500Z"
  }
}
```

### 4. JSON-RPC 2.0 Request (Full Protocol)

```http
POST /api/a2a/rpc HTTP/1.1
Host: localhost:3000
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "tasks/send",
  "params": {
    "skillId": "analyze_sentiment",
    "input": {
      "text": "I'm feeling a bit down today, need some cheerful music"
    },
    "sessionId": "user-session-456"
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "id": "task_x9y8z7w6v5u4",
    "skillId": "analyze_sentiment",
    "state": "completed",
    "input": {
      "text": "I'm feeling a bit down today, need some cheerful music"
    },
    "output": {
      "mood": "sad",
      "intensity": 0.6,
      "energy_level": "low",
      "secondary_mood": "hopeful",
      "suggest_music": true,
      "music_recommendation": "upbeat pop, cheerful indie",
      "confidence": 0.92
    },
    "createdAt": "2026-01-04T18:10:00.000Z",
    "updatedAt": "2026-01-04T18:10:01.200Z"
  }
}
```

### 5. Get Task Status

```http
GET /api/a2a/tasks/task_a1b2c3d4e5f6 HTTP/1.1
Host: localhost:3000
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "task_a1b2c3d4e5f6",
    "skillId": "play_by_mood",
    "state": "completed",
    "input": { "mood": "happy" },
    "output": { "success": true, "track": { "name": "Happy" } },
    "createdAt": "2026-01-04T18:07:40.000Z",
    "updatedAt": "2026-01-04T18:07:41.500Z"
  }
}
```

### 6. A2A Error Response

```json
{
  "jsonrpc": "2.0",
  "id": "req-003",
  "error": {
    "code": -32001,
    "message": "Agent not found"
  }
}
```

### 7. JSON-RPC Error Codes

| Code | Message | Description |
|------|---------|-------------|
| -32600 | Invalid Request | Invalid JSON-RPC version |
| -32601 | Method not found | Unknown method |
| -32602 | Invalid params | Missing required parameters |
| -32603 | Internal error | Server error |
| -32001 | Agent not found | Unknown agent ID |
| -32002 | Task not found | Unknown task ID |
| -32003 | Skill not found | No agent has this skill |

---

## 🤖 Agent Descriptions

### 🎯 OrchestratorAgent
The central coordinator that manages all agent interactions and user sessions.

| Skill | Description |
|-------|-------------|
| `coordinate_agents` | Routes tasks between agents based on capabilities |
| `manage_sessions` | Tracks user sessions and conversation state |
| `list_agents` | Returns list of all registered agents |

### 🗣️ SpeechAgent
Handles all audio processing - speech recognition and text-to-speech.

| Skill | Description | Model |
|-------|-------------|-------|
| `transcribe_audio` | Converts speech to text | Whisper-1 |
| `generate_speech` | Converts text to speech | TTS-1-HD (nova) |

**Features:**
- Voice Activity Detection (VAD) with configurable threshold
- Echo suppression to prevent feedback loops
- HD audio output for natural voice responses

### 💬 ConversationAgent
Processes natural language and determines user intent using OpenAI Function Calling.

| Skill | Description | Model |
|-------|-------------|-------|
| `parse_intent` | Analyzes text to determine action | GPT-4o |
| `generate_response` | Creates conversational responses | GPT-4o |

**Available Functions (Tools):**
```javascript
{
  "play_specific_music": { "query": "string" },
  "play_mood_music": { "mood": "string" },
  "pause_music": {},
  "resume_music": {},
  "skip_to_next": {},
  "skip_to_previous": {},
  "set_volume": { "level": "number" },
  "what_is_playing": {},
  "general_chat": { "message": "string" }
}
```

### 😊 SentimentAgent
Analyzes user mood and emotional state for music recommendations.

| Skill | Description | Model |
|-------|-------------|-------|
| `analyze_sentiment` | Detects mood from text | GPT-4o |
| `get_mood_history` | Returns recent mood patterns | - |

**Enhanced Output:**
```json
{
  "mood": "happy",
  "intensity": 0.8,
  "energy_level": "high",
  "secondary_mood": "excited",
  "suggest_music": true,
  "music_recommendation": "upbeat pop",
  "confidence": 0.95
}
```

### 🎵 SpotifyAgent
Controls Spotify playback and handles music recommendations.

| Skill | Description |
|-------|-------------|
| `play_music` | Play specific song/artist |
| `pause_music` | Pause playback |
| `resume_music` | Resume playback |
| `skip_next` | Next track |
| `skip_previous` | Previous track |
| `set_volume` | Adjust volume (0-100) |
| `get_current_track` | Get now playing |
| `play_by_mood` | Mood-based playlists |

**Features:**
- 20-track queue buffer for seamless skip/next
- Mood-to-genre mapping
- Web Playback SDK integration
- **Auto device selection** - `ensureDeviceActive()` automatically transfers playback to available device

---

## 📝 Logging System

All server activity is logged to both **terminal** (with colors) and **server.log** file:

### Log Categories

| Tag | Description |
|-----|-------------|
| `[A2A]` | A2A Protocol transactions |
| `[AGENT]` | Agent activity |
| `[BUS]` | MessageBus events |
| `[INFO]` | General server info |
| `[DEBUG]` | Debug events |

---

## 🔍 Actual A2A Transaction Logs

Here are **real logs** from a session showing A2A Protocol in action:

### Server Startup - Agent Registration

```log
=== Music Buddy Server Started at 2026-01-04T11:06:13.977Z ===

[2026-01-04T11:06:13.979Z] [A2A] [PROTOCOL] A2A Protocol Handler initialized
[2026-01-04T11:06:13.979Z] [A2A] [PROTOCOL] Agent registered: OrchestratorAgent {"skills":["coordinate_agents","manage_sessions","list_agents"]}
[2026-01-04T11:06:13.979Z] [A2A] [PROTOCOL] Agent registered: SpotifyAgent {"skills":["play_music","pause_music","resume_music","skip_next","skip_previous","set_volume","get_current_track","play_by_mood"]}
[2026-01-04T11:06:13.979Z] [A2A] [PROTOCOL] Agent registered: ConversationAgent {"skills":["parse_intent","generate_response"]}
[2026-01-04T11:06:13.980Z] [A2A] [PROTOCOL] Agent registered: SentimentAgent {"skills":["analyze_sentiment","get_mood_history"]}
[2026-01-04T11:06:13.980Z] [A2A] [PROTOCOL] Agent registered: SpeechAgent {"skills":["transcribe_audio","generate_speech"]}
```

### Voice Command Flow - "Play Queen"

```log
[2026-01-04T11:06:32.060Z] [AGENT] [SPEECH_AGENT] 🎤 Speech detected
[2026-01-04T11:06:38.510Z] [AGENT] [SPEECH_AGENT] 🔇 Silence detected, processing...
[2026-01-04T11:06:38.511Z] [AGENT] [SPEECH_AGENT] Processing 207480 bytes of audio
[2026-01-04T11:06:40.205Z] [AGENT] [SPEECH_AGENT] Transcribed: "The song from Queen."
[2026-01-04T11:06:40.205Z] [DEBUG] [BUS] Event: speech:transcribed
[2026-01-04T11:06:40.206Z] [AGENT] [CONVERSATION_AGENT] Processing: "The song from Queen."
[2026-01-04T11:06:40.891Z] [AGENT] [CONVERSATION_AGENT] Function called: play_specific_music {"query":"Queen"}
[2026-01-04T11:06:40.891Z] [AGENT] [CONVERSATION_AGENT] Intent detected {"intent":"play_music","query":"Queen","confidence":0.95}
[2026-01-04T11:06:40.892Z] [AGENT] [CONVERSATION_AGENT] Routing: play_music (confidence: 0.95)
[2026-01-04T11:06:40.892Z] [DEBUG] [BUS] Event: spotify:command
[2026-01-04T11:06:40.893Z] [AGENT] [SPOTIFY_AGENT] Command: play_music {"query":"Queen"}
```

### Spotify Agent - Device Management & Playback

```log
[2026-01-04T11:06:40.893Z] [AGENT] [SPOTIFY_AGENT] API Call: GET https://api.spotify.com/v1/me/player/devices
[2026-01-04T11:06:41.113Z] [AGENT] [SPOTIFY_AGENT] API Response: 200
[2026-01-04T11:06:41.115Z] [AGENT] [SPOTIFY_AGENT] Available devices: [{"name":"Music Buddy Web Player","id":"1dbfd02d6fa724e57c6fc39e197b593dc7d6268d","active":false}]
[2026-01-04T11:06:41.116Z] [AGENT] [SPOTIFY_AGENT] Transferring playback to device: 1dbfd02d6fa724e57c6fc39e197b593dc7d6268d
[2026-01-04T11:06:41.116Z] [AGENT] [SPOTIFY_AGENT] API Call: PUT https://api.spotify.com/v1/me/player
[2026-01-04T11:06:41.350Z] [AGENT] [SPOTIFY_AGENT] API Response: 204
[2026-01-04T11:06:41.653Z] [AGENT] [SPOTIFY_AGENT] API Call: GET https://api.spotify.com/v1/search?q=Queen&type=track&limit=20&market=US
[2026-01-04T11:06:42.447Z] [AGENT] [SPOTIFY_AGENT] API Response: 200
[2026-01-04T11:06:42.451Z] [AGENT] [SPOTIFY_AGENT] API Call: PUT https://api.spotify.com/v1/me/player/play?device_id=1dbfd02d6fa724e57c6fc39e197b593dc7d6268d
[2026-01-04T11:06:42.677Z] [AGENT] [SPOTIFY_AGENT] API Response: 204
[2026-01-04T11:06:42.678Z] [AGENT] [SPOTIFY_AGENT] Playing 20 tracks starting with: Bohemian Rhapsody
```

### Response Generation - TTS & Echo Suppression

```log
[2026-01-04T11:06:42.679Z] [DEBUG] [BUS] Event: spotify:result
[2026-01-04T11:06:42.680Z] [DEBUG] [BUS] Event: response:ready
[2026-01-04T11:06:42.681Z] [DEBUG] [BUS] Event: client:echo_suppress
[2026-01-04T11:06:42.682Z] [AGENT] [SPEECH_AGENT] Generating speech: "Now playing "Bohemian Rhapsody" by Queen..."
```

### No Audio Timeout (Echo Suppression Edge Case)

```log
[2026-01-04T11:06:54.589Z] [AGENT] [SPEECH_AGENT] 🎤 Speech detected
[2026-01-04T11:06:56.942Z] [DEBUG] [BUS] Event: client:echo_suppress
[2026-01-04T11:06:57.393Z] [AGENT] [SPEECH_AGENT] ⏱️ No audio received timeout - processing captured speech
[2026-01-04T11:06:57.395Z] [AGENT] [SPEECH_AGENT] Processing 76440 bytes of audio
```

### Session Management

```log
[2026-01-04T11:06:14.744Z] [AGENT] [ORCHESTRATOR] Session registered: session_1767524774744_ofbv3feto
[2026-01-04T11:06:14.744Z] [INFO] [SERVER] New connection: session_1767524774744_ofbv3feto
[2026-01-04T11:06:17.433Z] [INFO] [SERVER] Web Playback Device ID: 1dbfd02d6fa724e57c6fc39e197b593dc7d6268d
```

---

## 🎬 Complete End-to-End User Flow Example

This section shows **exactly** what happens when a user says:

> **"Play something relaxing, I had a stressful day"**

### Visual Flow Diagram

```mermaid
flowchart TD
    subgraph USER["🎤 USER SPEAKS"]
        Q["Play something relaxing, I had a stressful day"]
    end
    
    USER --> STEP1
    
    subgraph STEP1["STEP 1: Browser VAD Detection"]
        S1A["Audio level > 0.02 threshold"]
        S1B["Records audio until 1500ms silence"]
    end
    
    STEP1 -->|"WebSocket: audio base64"| STEP2
    
    subgraph STEP2["STEP 2: SpeechAgent"]
        S2A["Receives audio from WebSocket"]
        S2B["Calls Whisper API for transcription"]
    end
    
    STEP2 -->|"MessageBus: speech:transcribed"| STEP3
    
    subgraph STEP3["STEP 3: ConversationAgent"]
        S3A["Analyzes transcript"]
        S3B["Calls GPT-4o with Function Calling"]
    end
    
    STEP3 --> STEP4A & STEP4B
    
    subgraph STEP4A["STEP 4a: SpotifyAgent"]
        S4A1["MessageBus: spotify:command"]
        S4A2["Calls Spotify Web API"]
    end
    
    subgraph STEP4B["STEP 4b: SentimentAgent"]
        S4B1["MessageBus: sentiment:analyze"]
        S4B2["Calls GPT-4o for mood"]
    end
    
    STEP4A & STEP4B --> STEP5
    
    subgraph STEP5["STEP 5: Response Generation"]
        S5A["MessageBus: response:ready"]
        S5B["Combines results from all agents"]
    end
    
    STEP5 --> STEP6
    
    subgraph STEP6["STEP 6: SpeechAgent TTS"]
        S6A["Calls TTS-1-HD API"]
        S6B["Generates MP3 audio"]
    end
    
    STEP6 -->|"WebSocket: audio mp3"| STEP7
    
    subgraph STEP7["STEP 7: Browser Playback"]
        S7A["Plays TTS response"]
        S7B["Spotify starts playing music"]
    end
    
    STEP7 --> OUTPUT
    
    subgraph OUTPUT["🔊 OUTPUT"]
        O1["USER HEARS: Now playing relaxing music!"]
        O2["🎵 SPOTIFY PLAYS: Weightless by Marconi Union"]
    end
    
    style USER fill:#2d5016,stroke:#4ade80
    style OUTPUT fill:#1e3a5f,stroke:#60a5fa
```

---

### Step-by-Step with Actual Packets

#### **STEP 1: Voice Activity Detection (Browser)**

User speaks into microphone. Browser's VAD detects speech:

```javascript
// Browser client-side (index.html)
// Audio processor detects speech level > SPEECH_THRESHOLD (0.02)

onAudioProcess(event) {
  const audioData = event.inputBuffer.getChannelData(0);
  const level = Math.max(...audioData.map(Math.abs));
  
  if (level > 0.02) {  // Speech detected!
    this.isRecording = true;
    this.audioChunks.push(audioData);
  }
  
  // After 1500ms of silence, send to server
  if (silenceDuration > 1500 && this.audioChunks.length > 0) {
    this.sendAudio();
  }
}
```

**WebSocket Message Sent:**
```javascript
// Client → Server
{
  type: "audio",
  data: "UklGRiQAAABXQVZFZm10IBAAAA..." // Base64 encoded WAV audio (~150KB)
}
```

---

#### **STEP 2: SpeechAgent - Speech-to-Text**

SpeechAgent receives audio and calls Whisper API:

```javascript
// server-agents.js - SpeechAgent
class SpeechAgent {
  async handleAudioReceived({ audio, sessionId }) {
    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audio, 'base64');
    
    // Call OpenAI Whisper API
    const transcription = await this.transcribe(audioBuffer);
    
    // Publish to MessageBus
    this.bus.publish('speech:transcribed', {
      text: transcription,
      sessionId
    });
  }
}
```

**OpenAI Whisper API Request:**
```http
POST https://api.openai.com/v1/audio/transcriptions
Authorization: Bearer sk-...
Content-Type: multipart/form-data

{
  "file": <audio.wav binary>,
  "model": "whisper-1",
  "language": "en"
}
```

**Whisper API Response:**
```json
{
  "text": "Play something relaxing, I had a stressful day"
}
```

**MessageBus Event Published:**
```javascript
// SpeechAgent → MessageBus
bus.publish('speech:transcribed', {
  text: "Play something relaxing, I had a stressful day",
  sessionId: "session_1767474528786_vg5cpy0cl"
});
```

**Server Log:**
```
[21:08:58.626] [SPEECH_AGENT] Transcribed: "Play something relaxing, I had a stressful day"
[21:08:58.626] [BUS] Event: speech:transcribed
```

---

#### **STEP 3: ConversationAgent - Intent Detection with Function Calling**

ConversationAgent receives transcription and calls GPT-4o:

```javascript
// server-agents.js - ConversationAgent
class ConversationAgent {
  constructor() {
    // Subscribe to transcription events
    this.bus.subscribe('speech:transcribed', this.handleTranscription.bind(this));
  }
  
  async handleTranscription({ text, sessionId }) {
    // Call GPT-4o with Function Calling
    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a music assistant..." },
        { role: "user", content: text }
      ],
      tools: this.tools,  // Available functions
      tool_choice: "auto"
    });
    
    // Process function call result
    const toolCall = response.choices[0].message.tool_calls[0];
    // ...
  }
}
```

**OpenAI GPT-4o API Request:**
```http
POST https://api.openai.com/v1/chat/completions
Authorization: Bearer sk-...
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful music assistant that controls Spotify playback. Analyze user requests and call the appropriate function. Be concise in responses."
    },
    {
      "role": "user", 
      "content": "Play something relaxing, I had a stressful day"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "play_specific_music",
        "description": "Play a specific song, artist, or album",
        "parameters": {
          "type": "object",
          "properties": {
            "query": { "type": "string", "description": "Song, artist, or album name" }
          },
          "required": ["query"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "play_mood_music",
        "description": "Play music matching a specific mood or feeling",
        "parameters": {
          "type": "object",
          "properties": {
            "mood": { "type": "string", "description": "The mood (happy, sad, relaxing, energetic, etc.)" }
          },
          "required": ["mood"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "pause_music",
        "description": "Pause the current playback"
      }
    },
    {
      "type": "function",
      "function": {
        "name": "skip_to_next",
        "description": "Skip to next track"
      }
    },
    {
      "type": "function",
      "function": {
        "name": "general_chat",
        "description": "General conversation not related to music control",
        "parameters": {
          "type": "object",
          "properties": {
            "message": { "type": "string", "description": "Response message" }
          },
          "required": ["message"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

**GPT-4o API Response:**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1767474538,
  "model": "gpt-4o-2024-08-06",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_xyz789",
            "type": "function",
            "function": {
              "name": "play_mood_music",
              "arguments": "{\"mood\": \"relaxing\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ],
  "usage": {
    "prompt_tokens": 245,
    "completion_tokens": 18,
    "total_tokens": 263
  }
}
```

**Server Log:**
```
[21:08:59.407] [CONVERSATION_AGENT] Function called: play_mood_music { mood: 'relaxing' }
[21:08:59.407] [CONVERSATION_AGENT] Intent detected { intent: 'play_by_mood', mood: 'relaxing', confidence: 0.95 }
```

**ConversationAgent publishes TWO events:**

```javascript
// Event 1: Command to SpotifyAgent
bus.publish('spotify:command', {
  action: 'play_by_mood',
  mood: 'relaxing',
  sessionId: "session_1767474528786_vg5cpy0cl"
});

// Event 2: Request sentiment analysis (parallel)
bus.publish('sentiment:analyze', {
  text: "Play something relaxing, I had a stressful day",
  sessionId: "session_1767474528786_vg5cpy0cl"
});
```

---

#### **STEP 4a: SpotifyAgent - Music Playback**

SpotifyAgent receives command and calls Spotify Web API:

```javascript
// server-agents.js - SpotifyAgent
class SpotifyAgent {
  constructor() {
    this.bus.subscribe('spotify:command', this.handleCommand.bind(this));
  }
  
  async handleCommand({ action, mood, sessionId }) {
    if (action === 'play_by_mood') {
      // Map mood to search query
      const moodQueries = {
        relaxing: 'calm ambient chill',
        happy: 'upbeat pop dance',
        sad: 'melancholic acoustic',
        energetic: 'workout pump up'
      };
      
      const query = moodQueries[mood] || mood;
      
      // Search Spotify
      const tracks = await this.searchTracks(query);
      
      // Start playback with queue
      await this.playTracks(tracks);
    }
  }
}
```

**Spotify Search API Request:**
```http
GET https://api.spotify.com/v1/search?q=calm%20ambient%20chill&type=track&limit=20&market=US
Authorization: Bearer BQD...spotify_access_token...
```

**Spotify Search API Response:**
```json
{
  "tracks": {
    "items": [
      {
        "id": "7MXVkk9YMctZqd1Srtv4MB",
        "name": "Weightless",
        "artists": [{ "name": "Marconi Union" }],
        "album": { "name": "Weightless (Ambient Transmissions Vol. 2)" },
        "uri": "spotify:track:7MXVkk9YMctZqd1Srtv4MB"
      },
      {
        "id": "2Vv2DwNZYgaL5LN7vc7q9K",
        "name": "Sunset Lover",
        "artists": [{ "name": "Petit Biscuit" }],
        "uri": "spotify:track:2Vv2DwNZYgaL5LN7vc7q9K"
      }
      // ... 18 more tracks
    ]
  }
}
```

**Spotify Play API Request:**
```http
PUT https://api.spotify.com/v1/me/player/play?device_id=071b96a02515942052cf521d8f0e1760afada584
Authorization: Bearer BQD...spotify_access_token...
Content-Type: application/json

{
  "uris": [
    "spotify:track:7MXVkk9YMctZqd1Srtv4MB",
    "spotify:track:2Vv2DwNZYgaL5LN7vc7q9K",
    "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp",
    // ... 17 more track URIs (queue buffer)
  ]
}
```

**Spotify Play API Response:**
```
HTTP/1.1 204 No Content
```

**Server Log:**
```
[21:09:00.077] [SPOTIFY_AGENT] API Response: 200
[21:09:00.301] [SPOTIFY_AGENT] API Response: 204
[21:09:00.302] [SPOTIFY_AGENT] Playing 20 tracks starting with: Weightless
```

**SpotifyAgent publishes result:**
```javascript
bus.publish('spotify:result', {
  success: true,
  action: 'play_by_mood',
  track: {
    name: "Weightless",
    artist: "Marconi Union",
    album: "Weightless (Ambient Transmissions Vol. 2)"
  },
  queuedTracks: 20,
  sessionId: "session_1767474528786_vg5cpy0cl"
});
```

---

#### **STEP 4b: SentimentAgent - Mood Analysis (Parallel)**

SentimentAgent analyzes the user's emotional state:

```javascript
// server-agents.js - SentimentAgent
class SentimentAgent {
  constructor() {
    this.bus.subscribe('sentiment:analyze', this.handleAnalyze.bind(this));
  }
  
  async handleAnalyze({ text, sessionId }) {
    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: text }
      ],
      response_format: { type: "json_object" }
    });
    
    const sentiment = JSON.parse(response.choices[0].message.content);
    // Store in mood history for future recommendations
    this.moodHistory.push({ ...sentiment, timestamp: Date.now() });
  }
}
```

**OpenAI GPT-4o Sentiment API Request:**
```http
POST https://api.openai.com/v1/chat/completions
Authorization: Bearer sk-...
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "system",
      "content": "Analyze the emotional sentiment of the user's message. Return JSON with: mood (primary emotion), intensity (0-1), energy_level (low/medium/high), secondary_mood (if any), suggest_music (boolean), music_recommendation (genre suggestion), confidence (0-1)"
    },
    {
      "role": "user",
      "content": "Play something relaxing, I had a stressful day"
    }
  ],
  "response_format": { "type": "json_object" }
}
```

**GPT-4o Sentiment Response:**
```json
{
  "id": "chatcmpl-def456",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "{\"mood\": \"stressed\", \"intensity\": 0.7, \"energy_level\": \"low\", \"secondary_mood\": \"tired\", \"suggest_music\": true, \"music_recommendation\": \"ambient, chill, lo-fi\", \"confidence\": 0.92}"
      }
    }
  ]
}
```

**Parsed Sentiment:**
```json
{
  "mood": "stressed",
  "intensity": 0.7,
  "energy_level": "low",
  "secondary_mood": "tired",
  "suggest_music": true,
  "music_recommendation": "ambient, chill, lo-fi",
  "confidence": 0.92
}
```

**Server Log:**
```
[21:09:00.581] [SENTIMENT_AGENT] Sentiment {
  mood: 'stressed',
  intensity: 0.7,
  energy_level: 'low',
  secondary_mood: 'tired',
  suggest_music: true,
  music_recommendation: 'ambient, chill, lo-fi',
  confidence: 0.92
}
```

---

#### **STEP 5: ConversationAgent - Generate Response**

ConversationAgent receives Spotify result and generates response:

```javascript
// ConversationAgent receives spotify:result
handleSpotifyResult({ success, track, sessionId }) {
  const responseText = `Now playing "${track.name}" by ${track.artist} to help you unwind!`;
  
  bus.publish('response:ready', {
    text: responseText,
    sessionId
  });
}
```

**MessageBus Event:**
```javascript
bus.publish('response:ready', {
  text: 'Now playing "Weightless" by Marconi Union to help you unwind!',
  sessionId: "session_1767474528786_vg5cpy0cl"
});
```

---

#### **STEP 6: SpeechAgent - Text-to-Speech**

SpeechAgent generates audio response:

```javascript
// server-agents.js - SpeechAgent
class SpeechAgent {
  constructor() {
    this.bus.subscribe('response:ready', this.handleResponse.bind(this));
  }
  
  async handleResponse({ text, sessionId }) {
    // First, suppress echo detection
    this.bus.publish('client:echo_suppress', { 
      duration: 3000, 
      sessionId 
    });
    
    // Generate speech
    const audioResponse = await this.openai.audio.speech.create({
      model: "tts-1-hd",
      voice: "nova",
      input: text
    });
    
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    const audioBase64 = audioBuffer.toString('base64');
    
    // Send to client
    this.bus.publish('client:audio', {
      audio: audioBase64,
      text: text,
      sessionId
    });
  }
}
```

**OpenAI TTS API Request:**
```http
POST https://api.openai.com/v1/audio/speech
Authorization: Bearer sk-...
Content-Type: application/json

{
  "model": "tts-1-hd",
  "voice": "nova",
  "input": "Now playing \"Weightless\" by Marconi Union to help you unwind!"
}
```

**TTS API Response:**
```
HTTP/1.1 200 OK
Content-Type: audio/mpeg

<binary MP3 audio data ~45KB>
```

**Server Log:**
```
[21:09:00.304] [BUS] Event: client:echo_suppress
[21:09:00.305] [SPEECH_AGENT] Generating speech: "Now playing "Weightless" by Marconi Union..."
[21:09:03.558] [BUS] Event: client:audio
```

---

#### **STEP 7: Browser - Play Audio Response**

Browser receives audio and plays it:

**WebSocket Message Received:**
```javascript
// Server → Client
{
  type: "audio",
  data: "//uQxAAAAAANIAAAAAExBTUU..." // Base64 MP3 audio
}

{
  type: "echo_suppress",
  duration: 3000
}

{
  type: "transcript",
  text: "Now playing \"Weightless\" by Marconi Union to help you unwind!"
}
```

```javascript
// Browser client (index.html)
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.type === 'echo_suppress') {
    // Disable VAD to prevent echo
    this.echoSuppressUntil = Date.now() + msg.duration;
  }
  
  if (msg.type === 'audio') {
    // Decode and play audio
    const audioData = atob(msg.data);
    const audioBlob = new Blob([audioData], { type: 'audio/mp3' });
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.play();
  }
  
  if (msg.type === 'transcript') {
    // Update UI
    document.getElementById('response').textContent = msg.text;
  }
};
```

---

### Complete Timeline Summary

| Time | Component | Action | Data |
|------|-----------|--------|------|
| T+0ms | Browser | VAD detects speech | Audio level > 0.02 |
| T+1500ms | Browser | Silence detected, send audio | ~150KB WAV base64 |
| T+1600ms | SpeechAgent | Receive audio | WebSocket message |
| T+1700ms | SpeechAgent | Call Whisper API | Audio buffer |
| T+2600ms | SpeechAgent | Transcription complete | "Play something relaxing..." |
| T+2610ms | MessageBus | Publish event | `speech:transcribed` |
| T+2620ms | ConversationAgent | Receive transcription | Subscribe callback |
| T+2700ms | ConversationAgent | Call GPT-4o Function Calling | Tools + message |
| T+3500ms | ConversationAgent | Function call result | `play_mood_music({mood: "relaxing"})` |
| T+3510ms | MessageBus | Publish events | `spotify:command` + `sentiment:analyze` |
| T+3520ms | SpotifyAgent | Call Spotify Search API | "calm ambient chill" |
| T+3520ms | SentimentAgent | Call GPT-4o (parallel) | Sentiment analysis |
| T+4100ms | SpotifyAgent | Search results | 20 tracks |
| T+4200ms | SpotifyAgent | Call Spotify Play API | Track URIs + device ID |
| T+4400ms | SpotifyAgent | Playback started | 204 No Content |
| T+4450ms | SentimentAgent | Sentiment complete | mood: stressed, energy: low |
| T+4500ms | MessageBus | Publish result | `spotify:result` |
| T+4510ms | ConversationAgent | Generate response | "Now playing..." |
| T+4520ms | MessageBus | Publish | `response:ready` |
| T+4530ms | SpeechAgent | Echo suppress | 3000ms |
| T+4600ms | SpeechAgent | Call TTS-1-HD API | Response text |
| T+7000ms | SpeechAgent | Audio generated | ~45KB MP3 |
| T+7100ms | Browser | Play audio | Voice response |
| T+7100ms | Spotify | Music playing | "Weightless" |

**Total latency: ~7 seconds** (voice input to music + voice response)

---

### A2A Protocol Alternative Flow

The same flow can be triggered via A2A REST API:

```bash
# External system triggers mood-based playback via A2A
curl -X POST http://localhost:3000/api/a2a/tasks/send \
  -H "Content-Type: application/json" \
  -d '{
    "skillId": "play_by_mood",
    "input": { "mood": "relaxing" },
    "sessionId": "external-system-123"
  }'
```

**A2A Task Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "task_abc123def456",
    "skillId": "play_by_mood",
    "state": "completed",
    "input": { "mood": "relaxing" },
    "output": {
      "success": true,
      "track": {
        "name": "Weightless",
        "artist": "Marconi Union"
      },
      "queuedTracks": 20
    },
    "createdAt": "2026-01-04T18:09:00.000Z",
    "updatedAt": "2026-01-04T18:09:04.400Z"
  }
}
```

---

## 🧠 LLM Integration

### Models Used

| Model | Purpose | Agent |
|-------|---------|-------|
| **GPT-4o** | Intent detection with Function Calling | ConversationAgent |
| **GPT-4o** | Sentiment analysis with enhanced output | SentimentAgent |
| **Whisper-1** | Speech-to-text transcription | SpeechAgent |
| **TTS-1-HD** | Text-to-speech (voice: nova) | SpeechAgent |

---

## 🔄 Message Flow

### Internal Event System (MessageBus)

The MessageBus implements a Pub/Sub pattern for agent communication:

```javascript
// Event Types
'audio:received'       // Raw audio from client
'speech:transcribed'   // Text from Whisper
'spotify:command'      // Command for SpotifyAgent
'spotify:result'       // Result from SpotifyAgent
'sentiment:analyze'    // Request mood analysis
'response:ready'       // Response for TTS
'client:audio'         // Audio to send to client
'client:echo_suppress' // Enable echo suppression
'client:transcript'    // Send transcript to client
'client:listening_state' // VAD state change
```

### Hybrid Communication Architecture

The system uses **both** MessageBus (internal events) and A2A Protocol (structured tasks):

```mermaid
flowchart TB
    subgraph CL["📡 Communication Layer"]
        subgraph MB["📨 MessageBus - Real-time, Fire-and-Forget"]
            MB1["⚡ Fast event propagation between agents"]
            MB2["🔄 Internal agent-to-agent communication"]
            MB3["🌐 WebSocket client updates"]
            MB4["💨 No state tracking - fire and forget"]
        end
        
        subgraph A2A["🔗 A2A Protocol - Structured, Trackable"]
            A1["📋 Task state: submitted → working → completed"]
            A2["🌍 External REST API for third-party integration"]
            A3["🪪 Agent discovery via Agent Cards"]
            A4["✅ JSON-RPC 2.0 compliance"]
            A5["📝 Audit trail with timestamps"]
        end
    end
    
    style CL fill:#1a1a2e,stroke:#00d9ff,stroke-width:2px
    style MB fill:#0d2137,stroke:#00ff88,stroke-width:1px
    style A2A fill:#0d2137,stroke:#ff6b6b,stroke-width:1px
```

### Why Both?

| Feature | MessageBus | A2A Protocol |
|---------|------------|--------------|
| Speed | ⚡ Very fast | 🐢 Slightly slower |
| State tracking | ❌ No | ✅ Yes |
| External access | ❌ No | ✅ REST API |
| Discoverability | ❌ No | ✅ Agent Cards |
| Standards compliance | ❌ Custom | ✅ JSON-RPC 2.0 |

---

## � Requirements

### System Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 18.0.0+ | Required for ES modules support |
| **npm** | 9.0.0+ | Comes with Node.js |
| **Browser** | Chrome/Edge/Firefox | With WebRTC & Web Audio API support |
| **Microphone** | Any | For voice commands |

### API Keys Required

| Service | Purpose | Get it from |
|---------|---------|-------------|
| **OpenAI API** | GPT-4o (intent), Whisper (STT), TTS-1-HD | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Spotify Developer** | Music playback & search | [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) |

### Spotify Account

- ⚠️ **Spotify Premium required** for Web Playback SDK
- Free accounts cannot control playback via API

---

## 🚀 Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/mood-music-companion.git
cd mood-music-companion
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your actual API keys
nano .env   # or use any text editor
```

**Required `.env` configuration:**

```env
# OpenAI API Key (required)
OPENAI_API_KEY=sk-your-openai-api-key-here

# Spotify Developer App (required)
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback

# Server port (optional, default: 3000)
PORT=3000
```

### Step 4: Create Spotify Developer App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click **"Create App"**
3. Fill in:
   - App name: `Music Buddy`
   - App description: `Voice-enabled music companion`
   - Redirect URI: `http://127.0.0.1:8888/callback`
4. Click **"Settings"** → Copy **Client ID** and **Client Secret**
5. Add them to your `.env` file

### Step 5: Authenticate with Spotify (One-Time)

```bash
npm run auth
```

This will:
1. Open your browser to Spotify login
2. Ask for permissions (playback, library access, etc.)
3. Save tokens to `.spotify-tokens.json` (gitignored)

### Step 6: Start the Server

```bash
# Production mode
npm start

# Development mode (auto-restart on changes)
npm run dev
```

### Step 7: Open the App

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ⚙️ NPM Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `start` | `npm start` | Start the server |
| `dev` | `npm run dev` | Start with auto-reload (watch mode) |
| `auth` | `npm run auth` | Authenticate with Spotify |

---

## 🔒 Security Notes

The following files contain sensitive data and are **gitignored**:

| File | Contains | Status |
|------|----------|--------|
| `.env` | API keys, client secrets | ❌ Never commit |
| `.spotify-tokens.json` | Spotify access/refresh tokens | ❌ Never commit |
| `server.log` | Server logs (may contain tokens) | ❌ Never commit |

**Before publishing:**
- ✅ Ensure `.gitignore` includes all sensitive files
- ✅ Use `.env.example` as a template (no real keys)
- ✅ Never hardcode API keys in source code

---

## 🧪 Testing A2A Endpoints

### Using curl

```bash
# Get agent discovery
curl http://localhost:3000/.well-known/agent.json | jq

# List all agents
curl http://localhost:3000/api/a2a/agents | jq

# Send a task
curl -X POST http://localhost:3000/api/a2a/tasks/send \
  -H "Content-Type: application/json" \
  -d '{"skillId": "analyze_sentiment", "input": {"text": "I feel great today!"}}' | jq

# JSON-RPC request
curl -X POST http://localhost:3000/api/a2a/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": "1", "method": "agents/list", "params": {}}' | jq
```

---

## 📊 Mermaid Diagrams

The project includes visual documentation:

- **[flowchart.mmd](./flowchart.mmd)** - System architecture flowchart with A2A Protocol, logging, and device management
- **[sequence.mmd](./sequence.mmd)** - **Complete 9-phase sequence diagram** showing the entire flow from server startup to response, with A2A transactions clearly marked

### Sequence Diagram Phases

| Phase | Description | A2A Involved |
|-------|-------------|--------------|
| 1. Server Startup | `node server-agents.js` starts Express server | ✅ A2A Protocol initialized |
| 2. Agent Registration | All 5 agents register their AgentCards | ✅ A2A registerAgent() |
| 3. Client Connection | Browser connects via WebSocket, Spotify SDK initializes | ❌ |
| 4. User Speaks | VAD detects speech, audio streams to server | ❌ |
| 5. Speech-to-Text | SpeechAgent → Whisper API → transcription | ❌ (MessageBus) |
| 6. Intent Detection | ConversationAgent → GPT-4o Function Calling | ❌ (MessageBus) |
| 7. Spotify Playback | SpotifyAgent → Spotify API (device, search, play) | ❌ (MessageBus) |
| 8. TTS Response | SpeechAgent → TTS-1-HD → audio to client | ❌ (MessageBus) |
| 9. External A2A Task | REST API → A2A Protocol → Agent execution | ✅ Full A2A flow |

---

## 🔧 Configuration

### Models Configuration (server-agents.js)

```javascript
const MODELS = {
  INTENT_DETECTION: 'gpt-4o',      // Function calling for intents
  SENTIMENT_ANALYSIS: 'gpt-4o',    // Enhanced mood detection
  CHAT_RESPONSE: 'gpt-4o',         // Conversational responses
  TTS_MODEL: 'tts-1-hd',           // HD text-to-speech
  TTS_VOICE: 'nova',               // Voice persona
  WHISPER_MODEL: 'whisper-1'       // Speech recognition
};
```

### Voice Activity Detection

```javascript
const SPEECH_THRESHOLD = 0.02;   // Audio level to detect speech
const SILENCE_DURATION = 1500;   // ms of silence before processing
const NO_AUDIO_TIMEOUT = 500;    // ms failsafe if mic is paused mid-speech (echo suppression)
```

The `NO_AUDIO_TIMEOUT` handles edge cases where echo suppression pauses the microphone while the user is still speaking, ensuring speech is processed even if silence detection can't trigger.

---

## 📝 API Reference

### WebSocket Events (Client → Server)

| Event | Payload | Description |
|-------|---------|-------------|
| `audio` | Base64 audio data | Voice input from microphone |
| `set-device` | `{ deviceId }` | Set Spotify playback device |

### WebSocket Events (Server → Client)

| Event | Payload | Description |
|-------|---------|-------------|
| `transcript` | `{ text }` | Transcribed speech |
| `response` | `{ text, audio }` | AI response with audio |
| `listening` | `{ state }` | VAD state changes |
| `echo_suppress` | `{ duration }` | Suppress VAD temporarily |

---

READ the article about this project on [MYAIPRD.COM](https://myaiprd.com/blog/spotify-a2a-buddy)

---

## 📄 License

MIT

---

Built with ❤️ using OpenAI, Spotify Web API, and Google A2A Protocol
