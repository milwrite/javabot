# Bot Sportello: System Architecture & Operation Flow

This document provides a comprehensive visualization of **Bot Sportello's** internal logic, mapping the journey from a user's Discord message to a deployed application.

---

## 1. High-Level Architecture

The system operates as a **multi-pipeline agent** driven by a central classifier. It distinguishes between *creative* tasks (building games), *maintenance* tasks (edits/fixes), and *administrative* tasks (commits/info).

### Core Components
*   **Discord Interface (`index.js`)**: Handles events, maintains conversation history, and manages the "Thinking" state.
*   **Context Manager**: Aggregates channel history + recent bot actions (e.g., "just edited `game.html`").
*   **The Classifier (`requestClassifier.js`)**: A specialized LLM call that categorizes intent.
*   **The Factory (`gamePipeline.js`)**: A waterfall pipeline for generating complex content.
*   **The Generalist (`getLLMResponse`)**: An iterative tool-using loop for general problem solving.

---

## 2. Master Logic Flow

```mermaid
graph TD
    %% INPUT PHASE
    User([User Mention @Bot Sportello]) --> Context[Context Manager]
    Context --> History{Fetch History}
    History --> ActionCache{Check Recent Actions}
    ActionCache --> Classifier[LLM Classifier]

    %% CLASSIFICATION PHASE
    Classifier -- "CREATE_NEW" --> PipelineStart(Start Game Pipeline)
    Classifier -- "SIMPLE_EDIT" --> EditLoop(Streamlined Edit Loop)
    Classifier -- "FUNCTIONALITY_FIX" --> GeneralLoop(General Agentic Loop)
    Classifier -- "COMMIT" --> GitOps(Git Operations)
    Classifier -- "READ_ONLY / CONVERSATION" --> GeneralLoop

    %% FACTORY PIPELINE (Creation)
    subgraph "The Factory (Game Pipeline)"
        PipelineStart --> Architect[Architect Agent]
        Architect --> Plan(JSON Blueprint)
        Plan --> Builder[Builder Agent]
        Builder --> Code(HTML/JS)
        Code --> Tester[Tester Agent]
        Tester -- "Issues Found (Attempt < 3)" --> Builder
        Tester -- "Pass / Max Attempts" --> Scribe[Scribe Agent]
        Scribe --> Docs(Metadata & Logs)
        Docs --> AutoCommit[Auto-Commit to GitHub]
    end

    %% EDIT LOOP (Maintenance)
    subgraph "The Handyman (Edit Loop)"
        EditLoop --> EditLLM{Edit-Specific LLM}
        EditLLM -- "Tools: read_file / search" --> FileSys[(File System)]
        FileSys --> EditLLM
        EditLLM -- "Tool: edit_file" --> ApplyEdit[Apply Exact String Match]
        ApplyEdit --> VerifyEdit{Success?}
        VerifyEdit -- Yes --> ReplyUser
        VerifyEdit -- No --> GeneralLoop
    end

    %% GENERAL LOOP (Chat & Complex Fixes)
    subgraph "The Generalist (Agentic Loop)"
        GeneralLoop --> GenLLM{LLM (Reasoning/Tools)}
        GenLLM -- "Tools: search / read / write" --> FileSys
        FileSys --> GenLLM
        GenLLM -- "Tool: web_search" --> Web[(Internet)]
        Web --> GenLLM
        GenLLM -- "Final Response" --> ReplyUser
    end

    %% OUTPUT
    AutoCommit --> GitHub[(GitHub Repo)]
    GitHub --> LiveSite(Live URL)
    LiveSite --> ReplyUser([Discord Reply])
```

---

## 3. Component Breakdown

### A. The Brain (Request Classifier)
Located in `services/requestClassifier.js`.
It uses a specialized LLM prompt (or a keyword fallback if the API fails) to sort requests into one of six buckets:

1.  **`CREATE_NEW`**: Triggers the **Game Pipeline**.
    *   *Keywords*: "create", "build", "generate", "new game".
2.  **`SIMPLE_EDIT`**: Triggers the **Streamlined Edit Loop**.
    *   *Intent*: Simple text replacements, "change title to X".
3.  **`FUNCTIONALITY_FIX`**: Triggers the **General Agentic Loop** (Full Tool Access).
    *   *Intent*: Bug fixes, CSS adjustments, complex logic repair.
4.  **`COMMIT`**: Triggers direct **Git Operations**.
    *   *Keywords*: "commit", "save", "push".
5.  **`READ_ONLY`**: Triggers the **General Agentic Loop** (Restricted).
    *   *Intent*: "Where is X?", "List files", "Search for code".
6.  **`CONVERSATION`**: Triggers the **General Agentic Loop**.
    *   *Intent*: Chit-chat, greeting.

### B. The Factory (Game Pipeline)
Located in `services/gamePipeline.js` and `agents/`.
A dedicated 4-stage waterfall process for generating high-quality content.

| Stage | Agent | Role | System Context / Rules |
| :--- | :--- | :--- | :--- |
| **1. Plan** | **Architect** | Planner | Analyzes user request + recent build patterns. Outputs a **JSON Blueprint** (Files, Theme, Mechanics). |
| **2. Build** | **Builder** | Coder | Generates HTML/JS based on the Blueprint. **Rules**: Mobile-first, Noir theme, No TODOs. |
| **3. Test** | **Tester** | QA | Validates code. **Checks**: Mobile controls present? Viewport tag? Syntax errors? <br> *If failed*: Returns to Builder with issue list (Max 3 retries). |
| **4. Doc** | **Scribe** | Writer | Generates `projectmetadata.json` entry and casual release notes ("Doc Sportello voice"). |

### C. The Handyman (Edit Loops)

The system chooses between two modes for modifying content:

1.  **Streamlined Edit Loop (`getEditResponse`)**:
    *   **Goal**: Speed and precision.
    *   **Tools**: Restricted set (`read_file`, `search_files`, `edit_file`, `file_exists`).
    *   **Logic**: optimized for "Find X, Replace with Y".
    *   **Fallback**: If the edit is too complex, it suggests the General Loop.

2.  **General Agentic Loop (`getLLMResponse`)**:
    *   **Goal**: Problem solving and exploration.
    *   **Tools**: Full set (including `web_search`, `git_log`).
    *   **Logic**: Can iterate up to 6 times. It "Thinks", acts, observes tool output, and acts again.
    *   **Features**:
        *   **Action Injection**: "I see you just edited `game.html`, I will look there first."
        *   **Model Switching**: Can fallback from `GLM` to `Kimi` or `DeepSeek` if stuck.

### D. The Tool Belt
The AI interacts with the system via these defined functions:

*   `list_files(path)`: Explores directory structure.
*   `read_file(path)`: Reads content (auto-resolves URLs).
*   `search_files(pattern)`: Regex-based code search (grep).
*   `edit_file(path, old, new)`: **Exact String Replacement**.
    *   *Note*: Also supports `replacements: []` for batch editing.
*   `write_file(path, content)`: Creates or overwrites files.
*   `file_exists(path)`: Fast check (handles fuzzy naming).
*   `commit_changes(message)`: Git add, commit, push.
*   `web_search(query)`: Fetches external info.
*   `get_repo_status()`: Checks GitHub commit history.

---

## 4. Safety & Quality Control

### Zero Data Retention (ZDR)
*   **Provider**: All calls use OpenRouter with `provider: { data_collection: 'deny' }`.
*   **Models**: Only ZDR-compliant models are used (GLM-4.7, Kimi K2, DeepSeek V3.1, Qwen 3).

### Resilience Strategies
*   **Model Fallback**:
    *   Primary: `GLM-4.7` / `Kimi K2`.
    *   Fallback: If 500 errors occur, automatically switches to `DeepSeek` or `Qwen`.
*   **Retry Logic**:
    *   `axios-retry` handles network blips.
    *   Pipeline retries builds up to 3 times if the **Tester** finds critical issues.
*   **Context Management**:
    *   **Action Cache**: Remembers recent file edits to handle pronouns like "fix *that* file".
    *   **Discord Cache**: Fetches real-time channel history to maintain conversation flow.

---

## 5. Deployment

1.  **File System**: Agents write directly to the local `./src` directory.
2.  **Git Sync**:
    *   **Auto-Push**: `write_file` and `edit_file` trigger an immediate background push to GitHub via API.
    *   **Manual Commit**: Users can group changes with `/commit`.
3.  **Live Site**: The GitHub repository is connected to a static host (Railway/Vercel/Pages), serving content at `bot.inference-arcade.com/src/...`.
4.  **Feedback**: The bot waits for the `commit` to succeed before sending the final "Done" message with the live URL.
