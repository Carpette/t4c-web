# Game UI Phases — T4C Web

The game's UI is managed through a system of distinct phases, each corresponding to a specific state of the player's journey. This ensures that only relevant UI components are active and that data dependencies are handled gracefully.

| Phase                | Active Screens/Components | Description                                                                                                                           |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **`login`**          | Login                     | The initial phase when the user starts the game. The user can log in or register.                                                     |
| **`creation`**       | Character Creation        | The user is creating a new character. This phase is entered after a new registration or if the account has no characters.             |
| **`in-game`**        | HUD, All Game Panels      | The main game phase. The player is in the world, and all HUD elements and game panels (Inventory, Spells, etc.) are potentially active. |
| **`death`**          | Death Screen              | The player's character has died. This screen shows the cause of death and the Pantheon of the Dead.                                   |

### Phase Transitions

Transitions between phases are triggered by events, primarily from the network layer in response to server messages.

*   **`login` → `creation`**
    *   **Trigger**: `net.on('create_char')`
    *   **Description**: The server requests that the client create a new character.

*   **`login` → `in-game`**
    *   **Trigger**: `net.on('welcome')`
    *   **Description**: The user has successfully logged in and selected a character, and is entering the game world.

*   **`creation` → `in-game`**
    *   **Trigger**: After sending a `create` packet, the server responds with a `welcome` event.
    *   **Description**: The character has been created, and the player is entering the game world.

*   **`in-game` → `death`**
    *   **Trigger**: `net.on('died')`
    *   **Description**: The player's character has died.

*   **`death` → `creation`**
    *   **Trigger**: User clicks the "Create a new character" button (`btn-respawn`).
    *   **Description**: The player chooses to start over by creating a new character.

*   **Any Phase → `login`**
    *   **Trigger**: Logout, network error, or any fatal error.
    *   **Description**: The user is returned to the login screen.
