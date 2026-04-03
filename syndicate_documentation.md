# Ravolo Syndicate Engine API Documentation

The Syndicate Engine operates entirely over **WebSockets** for real-time performance. Standard HTTP `curl` commands cannot be used to invoke these actions. Instead, clients send and receive JSON (or MessagePack binary) frames over the established WebSocket connection.

If you wish to test this via CLI similar to `curl`, you can use the `wscat` tool:

```bash
# Connect to the WebSocket (Make sure you get a token via the HTTP /auth/verify endpoint first)
wscat -c "ws://localhost:8080/ws" -H "Authorization: Bearer <your_jwt_token>"
```

Once connected, you send JSON payloads matching the formats below.

---

## Standard Envelope format

### 📥 Inbound (From Client)

All requests MUST be sent in this format:

```json
{
  "type": "ACTION_TYPE",
  "payload": {
    "requestId": "unique-id-per-action",
    ... // Action specific fields
  }
}
```

### 📤 Outbound Success

```json
{
  "type": "ACTION_TYPE_OK",
  "data": {
    // Action specific response data
  }
}
```

### ❌ Outbound Error

All errors follow the unified `AppError` format:

```json
{
  "type": "ERROR",
  "code": "ERROR_CODE",
  "message": "Human readable, safe message",
  "details": {} // Optional metadata depending on error
}
```

---

## 1. Create a Syndicate (`CREATE_SYNDICATE`)

Defines and registers a new syndicate. The creator automatically becomes the `owner`.

**Note on visibility:**
`visibility` can be either `"public"` or `"private"`.

- **Public:** Any player can join instantaneously bypassing a waitlist.
- **Private:** Applying players are put into a "pending" queue, and an owner/officer must explicitly invoke `ACCEPT_REQUEST`.

**Request (`CREATE_SYNDICATE` type format):**

```json
{
  "type": "CREATE_SYNDICATE",
  "payload": {
    "requestId": "req-12345",
    "name": "Crimson Reapers",
    "description": "Farming fast, attacking faster.",
    "visibility": "public",
    "levelPreferenceMin": 10,
    "goldPreferenceMin": 1000,
    "emblemId": "emblem:wolf_crimson"
  }
}
```

**Success Response (`CREATE_SYNDICATE_OK`):**

```json
{
  "type": "CREATE_SYNDICATE_OK",
  "data": {
    "syndicateId": "uuid-...",
    "name": "Crimson Reapers"
  }
}
```

---

## 2. List Syndicates (`LIST_SYNDICATE`)

Retrieves a list of available syndicates. Optionally includes private syndicates.

**Request:**

```json
{
  "type": "LIST_SYNDICATE",
  "payload": {
    "includePrivate": false
  }
}
```

**Success Response (`LIST_SYNDICATE_OK`):**

```json
{
  "type": "LIST_SYNDICATE_OK",
  "data": [
    {
      "id": "uuid-...",
      "name": "Crimson Reapers",
      "description": "Farming fast, attacking faster.",
      "visibility": "public",
      "levelPreferenceMin": 10,
      "goldPreferenceMin": 1000,
      "members": 1,
      "shieldExpiresAtMs": 0,
      "idolLevel": 1
    }
  ]
}
```

---

## 3. View Syndicate Details (`VIEW_SYNDICATE`)

Fetches deep details about a specific syndicate, including its members roster.

**Request:**

```json
{
  "type": "VIEW_SYNDICATE",
  "payload": {
    "syndicateId": "uuid-..."
  }
}
```

**Success Response (`VIEW_SYNDICATE_OK`):**

```json
{
  "type": "VIEW_SYNDICATE_OK",
  "data": {
    // Extensive syndicate info + members
    "id": "uuid-...",
    "name": "Crimson Reapers",
    "ownerId": "user-uuid",
    "createdAtMs": 1775204678955,
    "membersList": [
      {
        "userId": "user-uuid",
        "role": "owner",
        "level": 15,
        "lastSeenAtMs": 1775204678955
      }
    ]
  }
}
```

---

## 4. Request to Join (`REQUEST_JOIN`)

Applies to enter a syndicate. Overrides immediately if public; sends a pending review request if private.

**Request:**

```json
{
  "type": "REQUEST_JOIN",
  "payload": {
    "requestId": "req-123456",
    "syndicateId": "uuid-..."
  }
}
```

**Success Response (`REQUEST_JOIN_OK`):**

```json
{
  "type": "REQUEST_JOIN_OK",
  "data": {
    "status": "pending_or_accepted"
  }
}
```

---

## 5. Accept Join Request (`ACCEPT_REQUEST`)

_(Restricted: requires internal Syndicate permissions)_

**Request:**

```json
{
  "type": "ACCEPT_REQUEST",
  "payload": {
    "requestId": "req-123",
    "syndicateId": "uuid-...",
    "userId": "uuid-of-approvee"
  }
}
```

**Success Response (`ACCEPT_REQUEST_OK`):**

```json
{
  "type": "ACCEPT_REQUEST_OK",
  "data": {
    "success": true
  }
}
```

---

## 6. Depost to Bank (`DEPOSIT_BANK`)

Transfers gold or item assets from the player's private inventory to the shared Syndicate bank.

**Request (Gold or Item):**

```json
{
  "type": "DEPOSIT_BANK",
  "payload": {
    "requestId": "req-transfer-1",
    "syndicateId": "uuid-...",
    "kind": "gold",
    "amount": 5000
    // OR if depositing items:
    // "kind": "item",
    // "itemId": "wheat",
    // "amount": 100
  }
}
```

**Success Response (`DEPOSIT_BANK_OK`):**

```json
{
  "type": "DEPOSIT_BANK_OK",
  "data": {
    "newBalance": 10000
  }
}
```

---

## 7. Buy Peace Shield (`BUY_SHIELD`)

Purchases a temporary immunity shield protecting the syndicate's bank from hostile attacks. Uses gold from the Syndicate bank.

**Request:**

```json
{
  "type": "BUY_SHIELD",
  "payload": {
    "requestId": "req-buy",
    "syndicateId": "uuid-...",
    "goldPaid": 2000
  }
}
```

---

## 8. Attack a Syndicate (`ATTACK_SYNDICATE`)

Launches an offensive bid against another syndicate to raid their gold or commodity bank.

**Request:**

```json
{
  "type": "ATTACK_SYNDICATE",
  "payload": {
    "requestId": "req-attack-1",
    "targetSyndicateId": "enemy-uuid-...",
    "attackPower": 500,
    "lootGoldMax": 10000
    // optionally can target specific items
    // "lootItemId": "wheat",
    // "lootItemMax": 500
  }
}
```

**Success Response (`ATTACK_SYNDICATE_OK`):**

```json
{
  "type": "ATTACK_SYNDICATE_OK",
  "data": {
    "success": true,
    "goldLooted": 8500
  }
}
```

---

## 9. Contribute to Idol Ritual (`IDOL_CONTRIBUTE`)

Submits resources to advance an ongoing Idol ritual event for a prestige boost.

**Request:**

```json
{
  "type": "IDOL_CONTRIBUTE",
  "payload": {
    "requestId": "req-idol",
    "syndicateId": "uuid-...",
    "requestKey": "idol-ritual-id-123",
    "itemId": "craft:wine",
    "amount": 5
  }
}
```

---

## 10. Chat (`SYNDICATE_CHAT_SEND` & `SYNDICATE_CHAT_LIST`)

Internal communication channel isolated securely to members of the specific syndicate.

**Send a Message:**

```json
{
  "type": "SYNDICATE_CHAT_SEND",
  "payload": {
    "requestId": "req-chat-1",
    "syndicateId": "uuid-...",
    "text": "Get online boys, we are getting raided!"
  }
}
```

**List Messages:**

```json
{
  "type": "SYNDICATE_CHAT_LIST",
  "payload": {
    "syndicateId": "uuid-..."
  }
}
```

_(Responses omitted for brevity but they emit `SYNDICATE_CHAT_SEND_OK` and `SYNDICATE_CHAT_LIST_OK`)_

---

## 11. Leave or Disband (`LEAVE_SYNDICATE` & `DISBAND_SYNDICATE`)

**Leave:**

```json
{
  "type": "LEAVE_SYNDICATE",
  "payload": {
    "requestId": "req-leave"
  }
}
```

**Disband (Owners Only):**

```json
{
  "type": "DISBAND_SYNDICATE",
  "payload": {
    "requestId": "req-disband",
    "syndicateId": "uuid-..."
  }
}
```

---

## 12. Read-Only Administrative Queries

Used mostly for populating dashboards. Formats mirror the standard pattern.

- `VIEW_SYNDICATE_MEMBER`: Query specific member profiles.
- `VIEW_GOLD_BANK`: Retrieve comprehensive gold balance and transaction log.
- `VIEW_COMMODITY_BANK`: Retrieve all stored items and their quantities.
- `VIEW_MEMBER_CONTRIBUTION`: See how much a specific player has deposited natively to track active vs. parasitic members.

---

## Common Error Codes (`BAD_REQUEST` vs Domain Errors)

If a user sends data that does not conform to the shapes above:

```json
{
  "type": "ERROR",
  "code": "BAD_REQUEST",
  "message": "Invalid message"
}
```

If a user hits a game engine rule logic (for instance, attacking a shielded syndicate):

```json
{
  "type": "ERROR",
  "code": "SHIELD_ACTIVE",
  "message": "Target syndicate is currently protected by a peace shield."
}
```

If a user sends packets too fast:

```json
{
  "type": "ERROR",
  "code": "RATE_LIMITED",
  "message": "Too many actions"
}
```
